# Scanner Benchmark 与交付门禁

## 目标

扫描视频链路在交付前必须满足以下门槛：

- **稳定 `>= 30 FPS`**
- 同时检查：
    - **Synthetic JS 解码基准**
    - **真实运行日志中的后端 FPS**
    - **真实运行日志中的前端有效 FPS**

如果任一项低于门槛，则视为 **FAIL**，不允许作为最终交付结果。

## 新增命令

```bash
pnpm test:benchmark
pnpm benchmark:scanner
pnpm benchmark:scanner:gate -- --log path/to/scanner-perf.log
pnpm benchmark:scanner:real -- --serial <adb-serial> --log artifacts/scanner-benchmarks/real.log
pnpm benchmark:scanner:real:gate -- --serial <adb-serial> --log artifacts/scanner-benchmarks/real.log
pnpm verify:scanner:delivery -- --log path/to/scanner-perf.log
pnpm verify:scanner:delivery:real -- --serial <adb-serial> --log artifacts/scanner-benchmarks/real.log
```

### 命令说明

- `pnpm test:benchmark`
    - 运行 benchmark 相关单元测试。
- `pnpm benchmark:scanner`
    - 只跑本地 synthetic benchmark。
    - 用于快速检查 JS/I420 解码链路是否出现明显性能回退。
- `pnpm benchmark:scanner:gate -- --log ...`
    - 运行 synthetic benchmark，并解析真实 scanner 日志。
    - 这是性能门禁命令。
- `pnpm verify:scanner:delivery -- --log ...`
    - 先跑 Rust/JS 测试，再跑完整 benchmark gate。
    - 适合作为交付前最终验收命令。
- `pnpm benchmark:scanner:real -- --serial ... --log ...`
    - 使用真实安卓设备执行一次完整终端 benchmark，并生成可复用的真实日志。
    - 会自动完成 `adb push`、端口转发、启动 `camera-server.jar`、运行 Rust backend harness、运行 frontend listener。
    - 默认使用当前交付参数 `640x360 @ 60 FPS` 的彩色预览流，以保证实时预览和单独高质量抽取分离后的性能门槛。
    - 默认不自动 gate，适合先采集真实日志。
- `pnpm benchmark:scanner:real:gate -- --serial ... --log ...`
    - 使用真实安卓设备执行完整终端 benchmark，并在结束后直接调用现有 gate。
    - 默认最多尝试 3 次；每次都会生成可单独复用的日志。
- `pnpm verify:scanner:delivery:real -- --serial ...`
    - 先跑 Rust/JS 测试，再执行真实设备 benchmark。
    - 这是当前最接近最终交付口径的验证命令。

## 日志要求

门禁脚本会解析两类日志：

### 1. 后端日志

至少需要包含类似行：

```text
[perf] overall: 455 frames in 15s = 30.3 fps
```

以及可选的单帧详情：

```text
[perf] frame#90 640x360 | tcp_read=0.9ms  h264_decode=8.5ms  preview_pack=4.0ms | NAL=11.0KB  I420=337.5KB
```

### 2. 前端日志

至少需要包含类似行：

```text
[perf:frontend] frame#90 | ipc=7.9ms  frame_decode=2.9ms | 337.5KB | effective 30.6 fps (97 polls)
```

## PASS / FAIL 判定

脚本会默认检查最近 **3 个 steady-state 窗口**：

- Synthetic benchmark 的 `min FPS >= 30`
- 后端日志最近 3 个 `overall fps` 的最小值 `>= 30`
- 前端日志最近 3 个 `effective fps` 的最小值 `>= 30`

只要任意一项不满足，就会直接返回非零退出码。

## 推荐流程

1. 启动 scanner 预览，进入稳定运行阶段。
2. 收集包含 `[perf]` 与 `[perf:frontend]` 的日志到文件。
3. 执行：

```bash
pnpm verify:scanner:delivery -- --log path/to/scanner-perf.log
```

4. 只有输出 `PASS`，且门槛保持在 `30 FPS` 以上，才能视为可交付。

## 真实设备终端 Benchmark

如果需要在不启动 Tauri UI 的前提下完成真实设备验收，使用：

```bash
pnpm benchmark:scanner:real -- --serial <adb-serial> --log artifacts/scanner-benchmarks/real.log
```

默认行为：

- 自动推送 `src-tauri/resources/camera-server.jar` 到设备
- 自动建立 `adb forward`
- 自动启动设备端 camera server
- 自动启动：
    - Rust backend benchmark harness
    - Node frontend benchmark listener
- 自动生成日志到 `artifacts/scanner-benchmarks/`，或使用 `--log` 指定明确输出文件
- 默认不执行 gate；生成的日志可直接喂给现有 `scripts/scanner/benchmark/scanner-benchmark.mjs`

如果希望一次性跑完真实设备 benchmark + gate：

```bash
pnpm benchmark:scanner:real:gate -- --serial <adb-serial> --log artifacts/scanner-benchmarks/real.log
```

也可以手动复用生成日志：

```bash
node scripts/scanner/benchmark/scanner-benchmark.mjs --mode gate --min-fps 30 --log artifacts/scanner-benchmarks/real.log
```

可选参数示例：

```bash
pnpm benchmark:scanner:real:gate -- --serial <adb-serial> --duration-secs 30 --attempts 5 --min-fps 30 --build-server
```

## 当前局限

- synthetic benchmark 只能覆盖 **本地 JS 解码链路**，不能替代真实设备端到端测试。
- 真实 gate 依赖日志采集质量；如果日志中缺失后端或前端 FPS 行，门禁会直接失败。
- 当前门禁默认使用最近 3 个窗口来定义“稳定”，如果后续需要更严格标准，可以继续扩大窗口数或延长采样时长。
