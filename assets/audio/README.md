# 音频文件放置说明

代码会优先读取 MP3；如果 MP3 不存在，会自动读取同名 WAV。

当前目录里已生成一套可上线的 WAV 占位音乐/音效。后续如果有更好的正式 MP3，直接放进当前目录并保持以下文件名不变即可覆盖为 MP3 优先播放：

- `bgm-main.mp3`
- `bgm-game.mp3`
- `sfx-hit.mp3`
- `sfx-bonus.mp3`
- `sfx-miss.mp3`
- `sfx-combo.mp3`
- `sfx-success.mp3`
- `sfx-leader-change.mp3`

WAV 兜底文件名：

- `bgm-main.wav`
- `bgm-game.wav`
- `sfx-hit.wav`
- `sfx-bonus.wav`
- `sfx-miss.wav`
- `sfx-combo.wav`
- `sfx-success.wav`
- `sfx-leader-change.wav`

如果某个文件暂时缺失，页面不会报错，游戏照常运行，只会在控制台输出 warning。
