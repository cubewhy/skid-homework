## Math Graph Tool (`plot-function`)

Use this tool to render 2D mathematical graphs, geometry, and statistical plots using the `function-plot` library.

### 1. Trigger Syntax

To render a graph, output a code block with the language tag `plot-function` containing a valid JSON object.

### 2. Core Concepts: `domain` vs. `range`

It is critical to understand the difference between the axis `domain` and the data `range`:

- **`xAxis.domain`**: Controls the visible area of the entire chart. Think of it as the "camera view" or the boundaries of the graph paper. It affects all plotted data.
- **`data.range`**: This is an optional property **inside a data object**. It limits or "clips" the drawing of that _specific function_. The function's line will only be drawn within this interval, and the rest of the graph will be blank.

### 3. JSON Configuration Schema

```plot-function
{
  "title": "Optional Chart Title",
  "xAxis": {
    "domain": [-10, 10], // REQUIRED: The visible x-axis range [min, max]. Pre-calculate all values.
    "label": "x-axis label"
  },
  "yAxis": {
    "domain": [-10, 10], // Optional: The visible y-axis range [min, max].
    "label": "y-axis label"
  },
  "grid": true,
  "data": [ // Array of functions and data points to plot
    {
      // --- Type 1: Explicit Function y = f(x) ---
      "fn": "x^2",
      "range": [-5, 5], // IMPORTANT: Limits the drawing of this specific function to the interval [-5, 5].
      "fnType": "linear",
      "graphType": "polyline",
      "color": "red",
      "label": "f(x) = x^2"
    },
    {
      // --- Type 2: Implicit Function f(x,y) = 0 ---
      "fn": "x^2 + y^2 - 9",
      "fnType": "implicit",
      "label": "Circle"
    },
    {
      // --- Type 3: Parametric x(t), y(t) ---
      "x": "cos(t)",
      "y": "sin(t)",
      "range": [0, 6.28], // The domain for the parameter 't'.
      "fnType": "parametric",
      "graphType": "polyline",
      "label": "Parametric"
    },
    {
      // --- Type 4: Scatter Plot / Points ---
      "points": [[1, 1], [2, 4], [3, 9]],
      "fnType": "points",
      "graphType": "scatter",
      "color": "blue"
    },
    {
      // --- Type 5: Vector ---
      "vector": [2, 3],
      "offset": [1, 1], // Optional origin point
      "fnType": "vector",
      "graphType": "polyline",
      "color": "green"
    }
  ]
}
```

### 4. Critical Rules

1.  **Use `range` to Limit Functions**: To draw only a segment of a function (e.g., `sin(x)` from 0 to π), you MUST use the `range` property inside its `data` object. For best results, set `xAxis.domain` to a similar or slightly larger interval to frame the segment properly.
2.  **NO Arithmetic in JSON**: You must pre-calculate all numbers before outputting the JSON.
    - ❌ `"domain": [-2*PI, 2*PI]`
    - ✅ `"domain": [-6.28, 6.28]`
3.  **Valid JSON**: Your output must be perfectly valid JSON. No trailing commas, no comments, and use double quotes for all keys and string values.
4.  **Functions**: Use standard math syntax (e.g., `sin(x)`, `exp(x)`, `x^2`, `sqrt(x)`).

### 5. Examples

#### Example 1: Plotting a Segment of a Sine Wave

To plot `sin(x)` only from 0 to 2π:

```plot-function
{
  "title": "Segment of sin(x)",
  "xAxis": {
    "domain": [-1, 7],
    "label": "x"
  },
  "yAxis": {
    "domain": [-1.5, 1.5],
    "label": "y"
  },
  "data": [
    {
      "fn": "sin(x)",
      "label": "sin(x) from 0 to 2π",
      "range": [0, 6.28],
      "color": "#2563eb"
    }
  ]
}
```

#### Example 2: Calculus (Area under a curve)

```plot-function
{
  "title": "Integration of cos(x)",
  "xAxis": { "domain": [-2, 2] },
  "yAxis": { "domain": [-0.5, 1.5] },
  "data": [
    {
      "fn": "cos(x)",
      "label": "cos(x)"
    },
    {
      "fn": "cos(x)",
      "range": [-1.57, 1.57],
      "closed": true,
      "color": "rgba(37, 99, 235, 0.2)",
      "label": "Area from -π/2 to π/2"
    }
  ]
}
```

#### Example 3: Linear Algebra (Vectors)

```plot-function
{
  "title": "Vector Addition",
  "xAxis": { "domain": [0, 5] },
  "yAxis": { "domain": [0, 5] },
  "grid": true,
  "data": [
    { "vector": [2, 1], "label": "v1", "color": "red", "fnType": "vector" },
    { "vector": [1, 3], "offset": [2, 1], "label": "v2", "color": "blue", "fnType": "vector" },
    { "vector": [3, 4], "label": "v1+v2", "color": "purple", "fnType": "vector" }
  ]
}
```
