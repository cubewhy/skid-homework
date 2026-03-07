import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type AiModelSummary,
  type AiSource,
  useAiStore,
} from "@/store/ai-store";

export interface SourceModels {
  source: AiSource;
  models: AiModelSummary[];
}

// Cache configuration
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = "available-models-cache";
const CACHE_TIMESTAMP_KEY = "available-models-cache-timestamp";
const CACHE_SOURCES_KEY = "available-models-cache-sources";

interface CachedModels {
  data: SourceModels[];
  timestamp: number;
  sourcesHash: string;
}

// Generate hash from enabled sources to detect API key changes
function generateSourcesHash(sources: AiSource[]): string {
  return sources
    .map((s) => `${s.id}:${s.apiKey ?? ""}:${s.baseUrl ?? ""}`)
    .sort()
    .join("|");
}

// Read cache from localStorage
function readCache(): CachedModels | null {
  try {
    const dataStr = localStorage.getItem(CACHE_KEY);
    const timestampStr = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    const sourcesHash = localStorage.getItem(CACHE_SOURCES_KEY);

    if (!dataStr || !timestampStr || !sourcesHash) return null;

    return {
      data: JSON.parse(dataStr) as SourceModels[],
      timestamp: parseInt(timestampStr, 10),
      sourcesHash,
    };
  } catch {
    return null;
  }
}

// Write cache to localStorage
function writeCache(data: SourceModels[], sourcesHash: string): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    localStorage.setItem(CACHE_SOURCES_KEY, sourcesHash);
  } catch {
    // Ignore storage errors
  }
}

// Clear cache
function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    localStorage.removeItem(CACHE_SOURCES_KEY);
  } catch {
    // Ignore storage errors
  }
}

export function useAvailableModels() {
  const sources = useAiStore((s) => s.sources);
  const getClientForSource = useAiStore((s) => s.getClientForSource);

  const enabledSources = useMemo(
    () => sources.filter((source) => source.enabled && source.apiKey),
    [sources]
  );

  const [sourceModelsMap, setSourceModelsMap] = useState<SourceModels[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Track sources hash to detect API key changes
  const sourcesHash = useMemo(
    () => generateSourcesHash(enabledSources),
    [enabledSources]
  );
  const prevSourcesHashRef = useRef<string | null>(null);

  // Ref to track if component is mounted (for forceRefetch cancellation)
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Force refresh function (bypasses cache)
  const forceRefetch = useCallback(async () => {
    setIsLoading(true);
    const results: SourceModels[] = [];

    for (const source of enabledSources) {
      try {
        const client = getClientForSource(source.id);
        if (client?.getAvailableModels) {
          const models = await client.getAvailableModels();
          results.push({ source, models });
        }
      } catch (error) {
        console.error(`Failed to fetch models for ${source.name}`, error);
      }
    }

    if (isMountedRef.current) {
      writeCache(results, sourcesHash);
      setSourceModelsMap(results);
      setIsLoading(false);
    }
  }, [enabledSources, getClientForSource, sourcesHash]);

  // Regular fetch with cache support
  const fetchModels = useCallback(
    async (forceRefresh = false) => {
      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cache = readCache();
        const now = Date.now();

        if (cache) {
          const isExpired = now - cache.timestamp > CACHE_DURATION_MS;
          const sourcesChanged = cache.sourcesHash !== sourcesHash;

          if (!isExpired && !sourcesChanged) {
            // Use cached data
            setSourceModelsMap(cache.data);
            return;
          }
        }
      }

      // Fetch fresh data
      await forceRefetch();
    },
    [forceRefetch, sourcesHash]
  );

  useEffect(() => {
    let cancelled = false;

    const doFetch = async () => {
      // Detect if sources changed (API key modified)
      const sourcesChanged =
        prevSourcesHashRef.current !== null &&
        prevSourcesHashRef.current !== sourcesHash;
      prevSourcesHashRef.current = sourcesHash;

      // If sources changed, clear cache and force refresh
      if (sourcesChanged) {
        clearCache();
      }

      // Check cache first
      const cache = readCache();
      const now = Date.now();

      if (cache && !sourcesChanged) {
        const isExpired = now - cache.timestamp > CACHE_DURATION_MS;
        const cacheSourcesChanged = cache.sourcesHash !== sourcesHash;

        if (!isExpired && !cacheSourcesChanged) {
          // Use cached data
          if (!cancelled) {
            setSourceModelsMap(cache.data);
          }
          return;
        }
      }

      // Fetch fresh data
      setIsLoading(true);
      const results: SourceModels[] = [];

      for (const source of enabledSources) {
        try {
          const client = getClientForSource(source.id);
          if (client?.getAvailableModels) {
            const models = await client.getAvailableModels();
            results.push({ source, models });
          }
        } catch (error) {
          console.error(`Failed to fetch models for ${source.name}`, error);
        }
      }

      if (!cancelled) {
        writeCache(results, sourcesHash);
        setSourceModelsMap(results);
        setIsLoading(false);
      }
    };

    void doFetch();

    return () => {
      cancelled = true;
    };
  }, [enabledSources, getClientForSource, sourcesHash]);

  // Flatten all models for simple list access
  const allModels = useMemo(() => {
    const models: AiModelSummary[] = [];
    for (const { models: sourceModels } of sourceModelsMap) {
      models.push(...sourceModels);
    }
    return models;
  }, [sourceModelsMap]);

  return {
    sourceModelsMap,
    allModels,
    isLoading,
    refetch: fetchModels,
    forceRefetch, // Force refresh bypassing cache
  };
}
