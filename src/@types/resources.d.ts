interface Resources {
  "commons": {
    "actions": {
      "chat": "聊天",
      "clear-all": "清空所有文件",
      "clear-confirmation": "再点击一次",
      "global-traits": {
        "desc": "自定义提示词将被拼接到最终的AI查询中",
        "placeholder": "你是一个聪明的AI助手, 为作业求解而设计",
        "submit-btn": "提交",
        "title": "编辑全局提示词",
        "trigger": "全局提示词编辑器"
      },
      "processing": "处理中...",
      "scan": "开始打滑",
      "settings": "设置",
      "title": "添加作业"
    },
    "chat-page": {
      "actions": {
        "back": "返回扫描页",
        "close-sidebar": "关闭侧边栏",
        "delete-chat": "删除对话",
        "new-chat": "新对话",
        "open-settings": "设置",
        "search": "搜索聊天..."
      },
      "composer": {
        "aigc-disclaimer": "AI 会犯错, 请核对重要信息",
        "placeholder": "输入问题或粘贴题目...",
        "send": "发送",
        "sending": "发送中..."
      },
      "conversation": {
        "empty": "选择一个对话或新建一个对话开始聊天。",
        "empty-title": "未选择对话"
      },
      "errors": {
        "missing-key": "{{provider}} 尚未配置 API 密钥。",
        "no-model": "请先填写模型名称。",
        "no-source": "请先在设置中启用至少一个已配置密钥的 AI 源。",
        "send-failed": "发送消息失败：{{error}}",
        "unsupported": "当前模型不支持对话功能。"
      },
      "history": {
        "empty": "还没有聊天记录，先开始一个对话吧。",
        "title": "历史记录",
        "unknown-source": "未知来源",
        "untitled": "新对话"
      },
      "source": {
        "empty": "没有匹配的模型",
        "model": "模型名称",
        "model-placeholder": "例如 gpt-4.1-mini 或 models/gemini-2.5-pro",
        "search": "搜索模型...",
        "section": "模型",
        "select": {
          "placeholder": "选择模型"
        }
      },
      "subtitle": "与已配置的模型一起讨论作业。",
      "title": "打滑作业聊天"
    },
    "import-settings-page": {
      "confirm": {
        "alert": {
          "description": "仅从可信来源导入配置，否则可能导致隐私泄露，请自行承担风险。",
          "title": "安全提醒"
        },
        "buttons": {
          "cancel": "取消",
          "confirm": "确认导入"
        },
        "description": "要将此配置添加到你的设置中吗？",
        "fields": {
          "base": "基础 URL：",
          "model": "模型名称：",
          "name": "名称：",
          "provider": "提供商："
        },
        "title": "导入 AI 模型"
      },
      "error": {
        "home": "返回首页",
        "parse-failed": "无法解析配置，链接可能已损坏。",
        "title": "错误"
      },
      "loading": {
        "parsing": "正在解析配置..."
      },
      "success": {
        "buttons": {
          "home": "返回首页",
          "settings": "设置",
          "undo": "撤销"
        },
        "description": "AI 模型 <strong>{{name}}</strong> 已成功导入。",
        "title": "全部就绪！"
      }
    },
    "improve-dialog": {
      "description": "基于当前答案和你的提示，让 AI 生成更详细的解答。",
      "placeholder": "例如：请添加更详细的步骤……",
      "submit": "提交",
      "title": "优化答案",
      "toasts": {
        "failed": {
          "description": "出错了：{{error}}",
          "parse": "解析响应失败，请打开开发者工具查看更多详情。",
          "title": "优化失败"
        },
        "no-key": {
          "description": "请在设置中为 {{provider}} 设置 API 密钥后再尝试。",
          "title": "就差一步"
        },
        "no-source": {
          "description": "请先在设置中启用至少一个 AI 源。",
          "title": "暂无可用 AI 源"
        },
        "post-processing": {
          "description": "图片预处理还在运行, 请再等等",
          "title": "还在处理..."
        },
        "processing": {
          "description": "正在使用 AI 优化你的解答，请耐心等待...",
          "title": "处理中"
        }
      },
      "trigger": "优化答案"
    },
    "init-page": {
      "features": {
        "camera": "拍下作业，立刻获得逐步讲解。",
        "setup": "快速上手——粘贴 Gemini API Key 就能开始。",
        "telemetry": "无遥测、无骚扰请求，只使用 Gemini API。"
      },
      "footer": {
        "notice": "基于 GPLv3 许可，由 cubewhy 创建。",
        "source": "源代码"
      },
      "form": {
        "advanced": {
          "base-url-helper": "留空将使用 {{provider}} 的默认地址。",
          "base-url-label": "API 基础地址（可选）",
          "base-url-placeholder": "{{provider}} 的默认接口地址",
          "title": "高级选项"
        },
        "api-hint": "在 <link>Google AI Studio</link> 申请 API Key。",
        "api-hint-openai": "在 <link>OpenAI 控制台</link> 申请 API Key。",
        "key-placeholder": "{{provider}} API 密钥",
        "provider": {
          "label": "AI 提供商"
        },
        "storage-note": "我们使用加密浏览器存储在本地保存你的密钥，绝不会上传到服务器。",
        "submit": "帮我省时间！"
      },
      "headline": {
        "highlight": "欢迎来到 SkidHomework",
        "subtitle": "摆脱作业内卷。"
      },
      "intro": "喜欢可汗学院式的自学，却常被堆积如山的作业拖住脚步？SkidHomework 本地运行，尊重你的隐私，让你把精力放在学习上，而不是重复劳动。",
      "preview": {
        "hints": "提示",
        "ocr": "OCR",
        "steps": "步骤",
        "title": "作业相机"
      },
      "tagline": "本地 • 私密 • 免费"
    },
    "inspect-dialog": {
      "answer": "答案",
      "close": "关闭窗口",
      "desc": "查看原始的 Markdown 文本",
      "explanation": "解析",
      "problem": "题目",
      "title": "检查原始数据"
    },
    "md": {
      "diagram": {
        "view-code": "查看代码",
        "view-diagram": "查看图像"
      },
      "generating-diagram": "生成图片中..."
    },
    "preview": {
      "drag-tip": "你可以把文件拖动到这个窗口中, 或者粘贴屏幕截图",
      "drag-tip-mobile": "轻触卡片即可放大，左右滑动快速浏览。",
      "drop-cancel": "拖到这里取消",
      "file-type": {
        "pdf": "PDF",
        "unknown": "未知类型"
      },
      "image-alt": "作业预览",
      "no-files": "没有文件 上传或拍照以开始",
      "remove": {
        "aria": "移除文件",
        "menu-item": "移除文件"
      },
      "rename": {
        "dialog": {
          "confirm": "确认",
          "desc": "请输入文件的新名称",
          "new-name": "新名称",
          "title": "重命名文件"
        },
        "menu-item": "重命名"
      },
      "supported-types": "支持图片、文本、Markdown、JSON 等格式",
      "tip": "提示：双击以在解决方案区域聚焦文件，单击文件全屏预览",
      "title": "预览"
    },
    "problem-list": {
      "item-label": "题目 {{index}}"
    },
    "qwen-callout": {
      "badge": "免费",
      "button": "点击获取",
      "title": "官方 Qwen3 服务",
      "tooltip": {
        "link": "控制台 -> 令牌管理",
        "prefix": "如何导入到 SkidHomework？你可以前往",
        "suffix": "-> 聊天 快捷导入 SkidHomework。"
      }
    },
    "scan-page": {
      "discussions-btn": "讨论区",
      "errors": {
        "missing-key": "{{provider}} 尚未配置 API 密钥。",
        "parsing-failed": "解析 AI 返回内容失败。",
        "processing-failed": {
          "answer": "请检查控制台中的错误并重试。",
          "explanation": "{{error}}",
          "problem": "多次重试后仍然处理失败。"
        }
      },
      "footer": {
        "license": "基于 GPL-3.0 许可发布。",
        "slogan": "学生的时间很宝贵",
        "source": "源代码"
      },
      "loading": "加载中...",
      "mobile": {
        "empty": "先添加文件或 PDF 开始使用。",
        "hint-pdf": "启用 Gemini 源即可支持 PDF 上传。",
        "hint-ready": "可以开始识别了，准备好后点击「开始打滑」。",
        "status": "已有 {{count}} 个文件",
        "status_plural": "已有 {{count}} 个文件",
        "tabs": {
          "capture": "采集",
          "preview": "预览"
        }
      },
      "tip": "我们不会在未经授权时上传您的文件",
      "title": "扫描你的作业",
      "toasts": {
        "all-processed": {
          "description": "没有待处理或失败的文件了。",
          "title": "全部已处理"
        },
        "done": {
          "description": "你的作业已经处理完成。",
          "title": "全部完成！"
        },
        "error": {
          "description": "处理过程中出了点问题，请查看控制台。",
          "title": "发生意外错误"
        },
        "no-key": {
          "description": "请在设置中为 {{provider}} 填写 API 密钥。",
          "title": "还差一步"
        },
        "no-model": {
          "description": "请先在设置中为 {{provider}} 选择模型。",
          "title": "需要模型"
        },
        "no-source": {
          "description": "请在设置中启用至少一个已配置密钥的 AI 提供商后再开始扫描。",
          "title": "尚未配置 AI 源"
        },
        "pdf-blocked": {
          "description": "要处理 PDF，请启用 Gemini 源。",
          "title": "PDF 上传已禁用"
        },
        "post-processing": {
          "description": "AI 需要一点时间来处理你的作业，请稍等片刻。",
          "title": "正在处理中......"
        },
        "unsupported-file": {
          "description": "您的文件MIME 类型为 {{mimeType}}, 当前不被 SkidHomework 支持",
          "title": "不支持的文件类型"
        },
        "working": {
          "description": "正在将 {{count}} 个文件发送到 AI 源...",
          "title": "正在处理..."
        }
      }
    },
    "settings-page": {
      "advanced": {
        "custom-base-url": {
          "helper": "留空将使用 {{provider}} 的默认地址。",
          "placeholder": "https://example.com/v1",
          "title": "自定义 API 基础地址"
        },
        "desc": "这些设置会影响上传和界面行为。",
        "explanation": {
          "mode": {
            "everything": "显示所有内容",
            "steps": "当我需要的时候显示必要的步骤"
          },
          "search-placeholder": "搜索...",
          "title": "解析显示模式"
        },
        "image-post-processing": {
          "enhancement": "开启二值化",
          "title": "图像后处理"
        },
        "title": "高级设置",
        "ui": {
          "clear-dialog-on-submit": "提交后清空输入框",
          "show-qwen-hint": "显示 Qwen3 服务提示",
          "title": "界面"
        }
      },
      "api-credentials": {
        "applied": "API 密钥已保存。",
        "desc": "为每个 AI 提供商在本地保存 API 密钥，我们不会上传。",
        "label": "API 密钥",
        "name": {
          "label": "来源名称",
          "placeholder": "展示在界面中的昵称"
        },
        "placeholder": "请输入 {{provider}} 的 API 密钥",
        "title": "API 凭据"
      },
      "appearance": {
        "desc": "自定义界面主题和显示语言。",
        "language": {
          "desc": "切换界面显示语言。",
          "label": "界面语言",
          "options": {
            "en": "English",
            "zh": "中文"
          }
        },
        "theme": {
          "desc": "使用系统偏好或手动指定明暗模式。",
          "label": "主题模式",
          "options": {
            "dark": "深色",
            "light": "浅色",
            "system": "跟随系统"
          }
        },
        "title": "界面与语言"
      },
      "back": "返回",
      "clear-input": "清除",
      "heading": "SkidHomework 设置",
      "model": {
        "desc": "选择或手动填写请求所使用的模型。",
        "fetch": {
          "error": "获取 {{provider}} 的模型列表失败，请检查 API 密钥或基地址。"
        },
        "manual": {
          "desc": "如果列表中没有想要的模型，可手动填写名称。",
          "placeholder": "模型标识符",
          "title": "自定义模型"
        },
        "refresh": "刷新模型列表",
        "sel": {
          "empty": "未找到匹配的模型。",
          "none": "未选择模型",
          "search": "搜索模型...",
          "unknown": "未知模型（{{name}}）"
        },
        "title": "模型配置"
      },
      "openai": {
        "poll-interval": {
          "desc": "当响应尚未完成时，两次状态检查之间的等待时间。",
          "title": "轮询间隔（毫秒）"
        },
        "poll-timeout": {
          "desc": "在判定失败前允许轮询的最长时间。",
          "title": "轮询超时（毫秒）"
        }
      },
      "reset": "重置",
      "shortcuts": {
        "actions": {
          "adb-screenshot": {
            "description": "通过 ADB 直接截取已连接安卓设备的屏幕。",
            "label": "ADB 截图"
          },
          "camera": {
            "description": "调用设备相机拍摄作业。",
            "label": "拍照"
          },
          "clear-all": {
            "description": "移除所有已上传的文件与结果。",
            "label": "清空全部"
          },
          "open-chat": {
            "description": "随时切换到聊天工作区。",
            "label": "打开聊天"
          },
          "open-global-traits-editor": {
            "description": "打开提示词编辑对话框",
            "label": "打开全局提示词编辑器"
          },
          "open-settings": {
            "description": "从任意页面快速进入设置。",
            "label": "打开设置"
          },
          "start-scan": {
            "description": "将所有待处理的文件发送给 AI 源。",
            "label": "开始识别"
          },
          "text-input": {
            "description": "打开文本输入对话框。",
            "label": "文本输入"
          },
          "upload": {
            "description": "打开文件选择器，挑选文件或 PDF。",
            "label": "上传文件"
          }
        },
        "clear": "清除",
        "desc": "为常用操作自定义快捷键，留空则表示禁用该快捷键。",
        "manual": {
          "invalid": "请输入包含修饰键和按键的有效组合。",
          "placeholder": "手动输入组合（如 Ctrl+1）"
        },
        "recording": "请按键…",
        "reset": "恢复默认",
        "title": "键盘快捷键",
        "unassigned": "未设置"
      },
      "sources": {
        "active": {
          "badge": "正在编辑",
          "label": "当前编辑的 AI 源"
        },
        "add": {
          "address": "API 地址 （可选）",
          "cancel": "取消",
          "confirm": "添加",
          "key": "API 密钥",
          "key-placeholder": "abcdef",
          "label": "新增 AI 源",
          "name": "显示名称（可选）",
          "name-placeholder": "例如：教室 Gemini",
          "provider": "选择提供商",
          "success": "已添加 {{name}}。",
          "title": "新增 AI 源"
        },
        "desc": "管理可用的 AI 提供商，并选择要配置的目标。",
        "enabled": {
          "label": "已启用的 AI 源",
          "toggle": "启用"
        },
        "make-active": "设为当前配置",
        "option": "{{name}} • {{provider}}",
        "providers": {
          "gemini": "Gemini",
          "openai": "OpenAI"
        },
        "remove": {
          "error": "至少保留一个 AI 源。",
          "label": "删除该源",
          "success": "已删除 {{name}}。"
        },
        "share": {
          "dialog": {
            "copy": "复制",
            "desc": "扫描二维码或者在另一台设备上访问URL来导入AI源. 请保护好这个链接.",
            "title": "分享AI源"
          },
          "label": "分享该源"
        },
        "title": "AI 源管理"
      },
      "thinking": {
        "budget": "可用思考预算",
        "desc": "针对支持的提供商调整高级思考设置。",
        "title": "思考参数",
        "tokens-unit": "Tokens"
      },
      "traits": {
        "desc": "定义助手的角色、语气或额外指示。",
        "placeholder": "例如：你是一位语气亲切且专业的学习助手。",
        "title": "系统提示（Traits）"
      }
    },
    "solution-viewer": {
      "answer": "答案",
      "chat": {
        "button": "与 AI 聊聊",
        "context": {
          "answer": "答案：\n{{answer}}",
          "explanation": "解析：\n{{explanation}}",
          "intro": "学习者正在查看以下内容：",
          "problem": "题目：\n{{problem}}"
        },
        "default-title": "作业对话",
        "fallback": {
          "answer": "答案信息缺失。",
          "explanation": "解析信息缺失。",
          "problem": "题目信息缺失。"
        },
        "no-problem": {
          "description": "请选择一个题目后再开始对话。",
          "title": "请先选择题目"
        },
        "no-source": {
          "description": "请先在设置中添加带密钥的 AI 源，再发起对话。",
          "title": "暂无可用模型"
        },
        "prefill": {
          "intro": "我想更好地理解这道题。",
          "outro": "可以一步步帮我讲解吗？"
        }
      },
      "copy": {
        "button": "复制答案",
        "failed": {
          "description": "请手动复制。",
          "title": "复制失败"
        },
        "success": {
          "description": "答案已复制到剪贴板。",
          "title": "已复制"
        }
      },
      "explanation": "解析",
      "navigation": {
        "next-image": "文件 ⟶",
        "next-problem": "下一题",
        "prev-image": "⟵ 文件",
        "prev-problem": "上一题"
      },
      "open-preview": "打开预览",
      "progress": {
        "prefix": "题目",
        "suffix": "/ 共 {{total}} 题"
      },
      "source-image": "原始文件："
    },
    "solutions": {
      "analyzing": "正在分析... 正在从你的文件中提取问题和解决方案",
      "export": {
        "answer-label": "答案",
        "button": "导出为 Markdown",
        "document-title": "作业解答汇总",
        "empty": {
          "description": "请先完成识别后再导出。",
          "title": "暂无可导出的内容"
        },
        "error": {
          "description": "生成 Markdown 文件时出错，请重试。",
          "title": "导出失败"
        },
        "explanation-label": "解析",
        "filename-prefix": "homework-solutions",
        "page-heading": "第 {{index}} 页 · {{name}}",
        "placeholders": {
          "answer": "_暂无答案。_",
          "explanation": "_暂无解析。_",
          "problem": "_暂无题干内容。_"
        },
        "problem-heading": "题目 {{index}}",
        "problem-label": "题干",
        "success": {
          "description": "解答文件已保存。",
          "title": "Markdown 已下载"
        }
      },
      "file-label": "文件 {{fileName}} • {{source}}",
      "focus-region-aria": "解决方案键盘聚焦区域（Tab/Shift+Tab 切换题目，空格/Shift+空格切换文件）",
      "gesture-hint": "左右滑动切换题目。",
      "idle": "点击\"开始打滑\"将文件发送给AI以在这里查看结果",
      "status": {
        "failed": "处理失败，请重试。",
        "pending": "正在处理中...",
        "stream": "正在推理...",
        "success": "该文件没有检测到题目。",
        "success-with-provider": "由 {{provider}} 处理成功。"
      },
      "streaming": {
        "placeholder": "AI 正在思考...",
        "title": "AI 输出"
      },
      "tabs": {
        "fallback": "文件 {{index}}"
      },
      "title": "解决方案",
      "toggle-preview": "切换预览"
    },
    "sources": {
      "adb": "ADB",
      "camera": "拍摄",
      "upload": "本地上传"
    },
    "upload-area": {
      "adb": {
        "capture-timeout": "ADB 截图超时，请检查连接",
        "connect": "ADB 连接",
        "connecting": "连接中...",
        "menu-aria-label": "ADB 操作菜单",
        "reconnect": "重新连接 ADB",
        "screenshot": "ADB 截图",
        "screenshot-busy": "采集中...",
        "screenshot-hint": "通过 ADB（WebUSB）从已连接的安卓设备捕获屏幕截图"
      },
      "camera-help-aria": "相机使用说明",
      "camera-tip": {
        "close": "知道了",
        "intro": "「<takePhoto>拍照</takePhoto>」按钮会调用浏览器的原生相机选择器（<capture>capture=\"environment\"</capture>）。在手机上会直接打开相机，在桌面端通常会退回到文件选择窗口。",
        "tips": ["尽量利用自然光线，避免眩光。", "让题目占满画面，保持文字清晰。", "一张照片拍一题，识别效果更好。"],
        "title": "在不同的设备上拍摄照片"
      },
      "pdf-disabled": "仅在启用 Gemini 源时支持 PDF 上传。",
      "take-photo": "拍照",
      "text-input": {
        "button": "文本",
        "description": "直接粘贴或输入题目内容。",
        "placeholder": "在此输入题目...",
        "submit": "确认",
        "title": "输入题目文本"
      },
      "toasts": {
        "adb-failed": "ADB 处理发生异常：{{error}}",
        "webusb-not-supported": "该浏览器不支持 WebUSB。"
      },
      "upload": "上传文件",
      "upload-tip": "支持图片和文本；PDF 需要启用 Gemini 源。"
    },
    "uploads-info": {
      "selected": "已选择"
    }
  }
}

export default Resources;
