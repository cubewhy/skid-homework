import os

path = 'src/components/actions/ActionsArea.tsx'
with open(path, 'r') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if 'const [confirmedClear, setConfirmedClear] = useState(false);' in line:
        new_lines.append(line)
        new_lines.append('  const [confirmedStop, setConfirmedStop] = useState(false);\n')
    elif 'handleSkidBtnClicked = useCallback(() => {' in line:
        # 重写 handleSkidBtnClicked 逻辑
        new_lines.append('  const handleSkidBtnClicked = useCallback(() => {\n')
        new_lines.append('    if (isWorking) {\n')
        new_lines.append('      if (confirmedStop) {\n')
        new_lines.append('        stopScan?.();\n')
        new_lines.append('        setConfirmedStop(false);\n')
        new_lines.append('      } else {\n')
        new_lines.append('        setConfirmedStop(true);\n')
        new_lines.append('      }\n')
        new_lines.append('      return;\n')
        new_lines.append('    }\n')
        new_lines.append('    startScan();\n')
        new_lines.append('  }, [isWorking, confirmedStop, startScan, stopScan]);\n')
        continue # 跳过旧的几行直到遇到 });
    elif 'useEffect(() => {' in line and 'if (!confirmedClear)' in line:
        # 增加确认超时自动重置
        new_lines.append(line)
    elif 'setConfirmedClear(false);' in line and '}, 3000);' in line:
        new_lines.append(line)
        new_lines.append('      setConfirmedStop(false);\n')
    elif '<Loader2Icon className="h-5 w-5 animate-spin" /> {t("stop")}' in line:
        # 修改样式
        new_lines.append('            <Loader2Icon className="h-5 w-5 animate-spin" /> {confirmedStop ? t("clear-confirmation") : t("stop")}\n')
    elif 'ref={skidBtnRef}' in line:
        # 增加 variant="destructive" 逻辑
        new_lines.append('        variant={isWorking ? "destructive" : "default"}\n')
        new_lines.append(line)
    else:
        new_lines.append(line)

# 这里逻辑比较复杂，松宝刚才直接用 sed 修改了一些关键点，现在尝试用更稳妥的方式拼接
with open(path, 'w') as f:
    f.writelines(new_lines)
