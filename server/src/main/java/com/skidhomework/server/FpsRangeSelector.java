package com.skidhomework.server;

import java.util.Locale;

/**
 * Selects the most suitable camera AE FPS range for a requested target frame rate.
 *
 * <p>The selector intentionally prefers tight, near-target ranges over wide ranges
 * that merely include the target. This avoids choices like {@code [15, 60]} winning
 * over {@code [30, 30]} when the request is close to 30 FPS.
 */
final class FpsRangeSelector {

    private FpsRangeSelector() {
        // Utility class.
    }

    static Selection select(int[][] ranges, int targetFps) {
        if (ranges == null || ranges.length == 0) {
            return null;
        }

        Selection bestSelection = null;

        for (int index = 0; index < ranges.length; index++) {
            int[] range = ranges[index];
            if (range == null || range.length < 2) {
                continue;
            }

            Selection candidate = new Selection(index, range[0], range[1], targetFps);
            if (!candidate.isValid()) {
                continue;
            }

            if (bestSelection == null || candidate.isBetterThan(bestSelection)) {
                bestSelection = candidate;
            }
        }

        return bestSelection;
    }

    static String describeCandidates(int[][] ranges, int targetFps) {
        if (ranges == null || ranges.length == 0) {
            return "none";
        }

        Selection bestSelection = select(ranges, targetFps);
        StringBuilder builder = new StringBuilder();

        for (int index = 0; index < ranges.length; index++) {
            int[] range = ranges[index];
            if (range == null || range.length < 2) {
                continue;
            }

            Selection selection = new Selection(index, range[0], range[1], targetFps);
            if (!selection.isValid()) {
                continue;
            }

            if (builder.length() > 0) {
                builder.append(", ");
            }

            builder.append(selection.describe());
            if (bestSelection != null && selection.index == bestSelection.index) {
                builder.append(" <- selected");
            }
        }

        return builder.length() == 0 ? "none" : builder.toString();
    }

    static final class Selection {
        final int index;
        final int lower;
        final int upper;
        final int targetFps;
        final int upperDistance;
        final int lowerDistance;
        final int span;
        final boolean containsTarget;
        final boolean fixed;

        Selection(int index, int lower, int upper, int targetFps) {
            this.index = index;
            this.lower = lower;
            this.upper = upper;
            this.targetFps = targetFps;
            this.upperDistance = Math.abs(upper - targetFps);
            this.lowerDistance = Math.abs(lower - targetFps);
            this.span = upper - lower;
            this.containsTarget = lower <= targetFps && targetFps <= upper;
            this.fixed = lower == upper;
        }

        boolean isValid() {
            return lower > 0 && upper > 0 && lower <= upper;
        }

        boolean isBetterThan(Selection other) {
            if (upperDistance != other.upperDistance) {
                return upperDistance < other.upperDistance;
            }
            if (lowerDistance != other.lowerDistance) {
                return lowerDistance < other.lowerDistance;
            }
            if (span != other.span) {
                return span < other.span;
            }
            if (containsTarget != other.containsTarget) {
                return containsTarget;
            }
            if (fixed != other.fixed) {
                return fixed;
            }
            if (upper != other.upper) {
                return upper > other.upper;
            }
            if (lower != other.lower) {
                return lower > other.lower;
            }
            return index < other.index;
        }

        String describe() {
            return String.format(
                    Locale.US,
                    "[%d,%d](upperΔ=%d lowerΔ=%d span=%d contains=%s fixed=%s)",
                    lower,
                    upper,
                    upperDistance,
                    lowerDistance,
                    span,
                    containsTarget,
                    fixed
            );
        }
    }
}
