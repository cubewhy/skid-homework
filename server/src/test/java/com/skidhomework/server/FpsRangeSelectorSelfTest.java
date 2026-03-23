package com.skidhomework.server;

/**
 * Lightweight host-side verification for the FPS range ranking heuristics.
 *
 * <p>This intentionally avoids Android dependencies so it can run with the
 * standard JDK during local validation.
 */
public final class FpsRangeSelectorSelfTest {

    private FpsRangeSelectorSelfTest() {
        // Utility class.
    }

    public static void main(String[] args) {
        assertSelection(
                new int[][] {
                        {15, 60},
                        {24, 30},
                        {30, 30},
                },
                32,
                2
        );
        assertSelection(
                new int[][] {
                        {15, 30},
                        {24, 30},
                        {30, 30},
                },
                30,
                2
        );
        assertSelection(
                new int[][] {
                        {15, 60},
                        {30, 60},
                        {60, 60},
                },
                32,
                1
        );

        System.out.println("FpsRangeSelectorSelfTest passed.");
    }

    private static void assertSelection(int[][] ranges, int targetFps, int expectedIndex) {
        FpsRangeSelector.Selection selection = FpsRangeSelector.select(ranges, targetFps);
        if (selection == null) {
            throw new AssertionError("Expected a selection for target " + targetFps + " fps.");
        }

        if (selection.index != expectedIndex) {
            throw new AssertionError(
                    "Unexpected selection for target "
                            + targetFps
                            + " fps. Expected index "
                            + expectedIndex
                            + " but got "
                            + selection.index
                            + ". Candidates: "
                            + FpsRangeSelector.describeCandidates(ranges, targetFps)
            );
        }
    }
}
