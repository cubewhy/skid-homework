import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AiModelSummary, type AiSource, useAiStore, } from "@/store/ai-store";

export interface SourceModels {
  source: AiSource;
  models: AiModelSummary[];
}

export interface SourceFetchError {
  sourceId: string;
  sourceName: string;
  code: string; // "auth", "rate-limit", "network", "unknown"
}

// Cache stores only sourceId to avoid leaking API keys
interface CachedSourceModels {
  sourceId: string;
  models: AiModelSummary[];
}

// Cache configuration
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const CACHE_KEY = "available-models-cache";
const CACHE_TIMESTAMP_KEY = "available-models-cache-timestamp";
const CACHE_SOURCES_KEY = "available-models-cache-sources";

interface CachedModels {
  data: CachedSourceModels[];
  timestamp: number;
  sourcesHash: string;
}

// Generate a one-way hash from enabled sources to detect config changes
// Uses SHA-256 to avoid storing API keys in localStorage
async function generateSourcesHashAsync(sources: AiSource[]): Promise<string> {
  const input = sources
    .map((s) => `${s.id}:${s.apiKey ?? ""}:${s.baseUrl ?? ""}`)
    .sort()
    .join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Synchronous version for initial render (uses simple hash, not persisted)
function generateSourcesHashSync(sources: AiSource[]): string {
  const input = sources
    .map((s) => `${s.id}:${s.apiKey ?? ""}:${s.baseUrl ?? ""}`)
    .sort()
    .join("|");

  // Simple hash for in-memory comparison only (not persisted)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

// Read cache from localStorage
function readCache(): CachedModels | null {
  try {
    const dataStr = localStorage.getItem(CACHE_KEY);
    const timestampStr = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    const sourcesHash = localStorage.getItem(CACHE_SOURCES_KEY);

    if (!dataStr || !timestampStr || !sourcesHash) return null;

    return {
      data: JSON.parse(dataStr) as CachedSourceModels[],
      timestamp: parseInt(timestampStr, 10),
      sourcesHash,
    };
  } catch {
    return null;
  }
}

// Write cache to localStorage (only stores sourceId, not full source object)
function writeCache(data: CachedSourceModels[], sourcesHash: string): void {
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

// Convert cached data to SourceModels by looking up sources from store
function hydrateCachedData(
  cached: CachedSourceModels[],
  sources: AiSource[]
): SourceModels[] {
  const sourceMap = new Map(sources.map((s) => [s.id, s]));
  const results: SourceModels[] = [];

  for (const { sourceId, models } of cached) {
    const source = sourceMap.get(sourceId);
    if (source) {
      results.push({ source, models });
    }
  }

  return results;
}

// Convert SourceModels to cacheable format (strips sensitive data)
function toCacheFormat(data: SourceModels[]): CachedSourceModels[] {
  return data.map(({ source, models }) => ({
    sourceId: source.id,
    models,
  }));
}

function classifyError(error: unknown): string {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("401") || msg.includes("403") || msg.includes("invalid") || msg.includes("unauthorized") || msg.includes("forbidden")) {
      return "auth";
    }
    if (msg.includes("429") || msg.includes("rate") || msg.includes("quota")) {
      return "rate-limit";
    }
    if (msg.includes("network") || msg.includes("fetch") || msg.includes("econnrefused") || msg.includes("timeout")) {
      return "network";
    }
  }
  return "unknown";
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
  const [fetchErrors, setFetchErrors] = useState<SourceFetchError[]>([]);
  const [hasFetched, setHasFetched] = useState(false);
  const [sourcesHash, setSourcesHash] = useState<string>("");

  // Track sources hash to detect API key changes (sync version for comparisons)
  const sourcesHashSync = useMemo(
    () => generateSourcesHashSync(enabledSources),
    [enabledSources]
  );
  const prevSourcesHashRef = useRef<string | null>(null);

  // Compute async hash for cache storage (only when sources change)
  useEffect(() => {
    let cancelled = false;
    generateSourcesHashAsync(enabledSources).then((hash) => {
      if (!cancelled) {
        setSourcesHash(hash);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [enabledSources]);

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
    const errors: SourceFetchError[] = [];

    for (const source of enabledSources) {
      try {
        const client = getClientForSource(source.id);
        if (client?.getAvailableModels) {
          const models = await client.getAvailableModels();
          results.push({ source, models });
        }
      } catch (error) {
        console.error(`Failed to fetch models for ${source.name}`, error);
        errors.push({
          sourceId: source.id,
          sourceName: source.name,
          code: classifyError(error),
        });
      }
    }

    if (isMountedRef.current) {
      // Compute fresh hash for cache
      const hash = await generateSourcesHashAsync(enabledSources);
      writeCache(toCacheFormat(results), hash);
      setSourceModelsMap(results);
      setFetchErrors(errors);
      setHasFetched(true);
      setIsLoading(false);
    }
  }, [enabledSources, getClientForSource]);

  // Regular fetch with cache support
  const fetchModels = useCallback(
    async (forceRefresh = false) => {
      // Check cache first (unless force refresh)
      if (!forceRefresh && sourcesHash) {
        const cache = readCache();
        const now = Date.now();

        if (cache) {
          const isExpired = now - cache.timestamp > CACHE_DURATION_MS;
          const sourcesChanged = cache.sourcesHash !== sourcesHash;

          if (!isExpired && !sourcesChanged) {
            // Use cached data (hydrate with current sources via ref)
            setSourceModelsMap(hydrateCachedData(cache.data, useAiStore.getState().sources));
            setFetchErrors([]);
            setHasFetched(true);
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
      // Detect if sources changed (API key modified) using sync hash for in-memory comparison
      const sourcesChanged =
        prevSourcesHashRef.current !== null &&
        prevSourcesHashRef.current !== sourcesHashSync;
      prevSourcesHashRef.current = sourcesHashSync;

      // If sources changed, clear cache and force refresh
      if (sourcesChanged) {
        clearCache();
      }

      // Check cache first (need async hash for cache comparison)
      const asyncHash = await generateSourcesHashAsync(enabledSources);
      if (cancelled) return;

      const cache = readCache();
      const now = Date.now();

      if (cache && !sourcesChanged) {
        const isExpired = now - cache.timestamp > CACHE_DURATION_MS;
        const cacheSourcesChanged = cache.sourcesHash !== asyncHash;

        if (!isExpired && !cacheSourcesChanged) {
          // Use cached data (hydrate with current sources via ref)
          if (!cancelled) {
            setSourceModelsMap(hydrateCachedData(cache.data, useAiStore.getState().sources));
            setFetchErrors([]);
            setHasFetched(true);
          }
          return;
        }
      }

      // Fetch fresh data
      setIsLoading(true);
      const results: SourceModels[] = [];
      const errors: SourceFetchError[] = [];

      for (const source of enabledSources) {
        try {
          const client = getClientForSource(source.id);
          if (client?.getAvailableModels) {
            const models = await client.getAvailableModels();
            results.push({ source, models });
          }
        } catch (error) {
          console.error(`Failed to fetch models for ${source.name}`, error);
          errors.push({
            sourceId: source.id,
            sourceName: source.name,
            code: classifyError(error),
          });
        }
      }

      if (!cancelled) {
        writeCache(toCacheFormat(results), asyncHash);
        setSourceModelsMap(results);
        setFetchErrors(errors);
        setHasFetched(true);
        setIsLoading(false);
      }
    };

    void doFetch();

    return () => {
      cancelled = true;
    };
    // NOTE: `sources` is intentionally excluded; cache hydration reads the
    // latest sources from the store to avoid refetching on every store update.

  }, [enabledSources, getClientForSource, sourcesHashSync]);

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
    fetchErrors,
    hasFetched,
    refetch: fetchModels,
    forceRefetch, // Force refresh bypassing cache
  };
}
