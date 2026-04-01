# SkidHomework Platform

![Thumbnail](.github/images/skidhw-thumbnail-new.png)

Ergonomically designed, AI-powered homework solver

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcubewhy%2Fskid-homework)

[Telegram Group](https://t.me/earthsworth) (SFW content, ZH/EN Only)

## Why SkidHomework

If this tool saved your time, please give us a star or share this tool to your friends!

- Save time
- No telemetry
- Open source, no black-box
- No spamming calls
- No phone number required
- Customizable answer styles, not limited to standard answers
- Can access from your computer, tablet or mobile phone
- Ergonomics, keyboard workflow support
- ADB Screenshot support (WebUSB on Web, native Remote ADB pair/connect on Tauri desktop)

## Try it

The official instance is available at [https://skid.996every.day](https://skid.996every.day)

You need to request a Gemini API key for AI usage.

[Google AI Studio](https://aistudio.google.com/api-keys)

## Shortcuts

| Shortcut    | Description                              |
| ----------- | ---------------------------------------- |
| Ctrl+1      | Upload file                              |
| Ctrl+2      | Take a photo                             |
| Ctrl+3      | Submit file to AI                        |
| Ctrl+4      | Delete all files                         |
| Ctrl+5      | Open settings page                       |
| Ctrl+X      | Open Global Traits Editor                |
| ESC         | Close settings page / current dialog box |
| Space       | Next problem                             |
| Shift+Space | Previous problem                         |
| Tab         | Next file                                |
| Shift+Tab   | Previous file                            |
| /           | Improve solution                         |

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=cubewhy/skid-homework&type=Date)](https://www.star-history.com/#cubewhy/skid-homework&Date)

## I don't have a camera on my computer, please help

You have two local-only options:

- Web: use ADB screenshot via WebUSB in a supported browser.
- Tauri desktop: use Android Wireless debugging with native Remote ADB pair/connect.

You can also try [SkidCamera](https://github.com/996-ai/SkidCamera)
and follow the guide in the SkidCamera README.

## Why Too Much Homework is bad

- Waste time
- Inefficiency
- Affects sleep quality
- Affects mental health

## Thinking this is violation of ethics?

If you think so, please do not use it.

Homework is designed to help students to understand the knowledge,
not used to control students.

I personally use Khan Academy and Wikipedia to learn things,
that's time-saving and efficiency.

But schools may ask me to submission the homework...
This platform is just a workaround for this.

### How to Escape

- Use Khan Academy, Wikipedia or other self-learning resources
- Leave school at 6:30

## Development

### Quick deploy using Vercel

Please click the button below

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fcubewhy%2Fskid-homework)

### Quick deploy with Docker

```shell
# Replace <commit_hash> with the actual commit hash
docker run -p 3000:3000 ghcr.io/cubewhy/skid-homework:sha-<commit_hash>
```

Here's the Docker Compose manifest

```yaml
services:
  skidhw:
    # Replace <commit_hash> with the actual commit hash
    image: ghcr.io/cubewhy/skid-homework:sha-<commit_hash>
    ports:
      - 3000:3000
```

## Tauri Multi-Platform Releases

The repository now includes a `Tauri Release` GitHub Actions workflow that can be triggered manually to build Tauri
release artifacts for:

- Android: APK / AAB
- Linux: AppImage / `.deb` / `.rpm`
- Windows: NSIS / MSI
- macOS: separate Intel and Apple Silicon builds

The workflow automatically:

- calculates the next semantic version from existing Git tags;
- generates a project-specific GitHub Release markdown page;
- collects the platform artifacts and publishes them in a single GitHub Release.

If you want signed Android release builds in CI, configure these repository secrets:

- `ANDROID_KEYSTORE_BASE64`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

## License

This work is licensed under GPL-3.0

You're allowed to use, share and modify.
