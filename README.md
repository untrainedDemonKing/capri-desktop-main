**English** · [Français](README.fr.md) · [Русский](README.ru.md)

# Capri

Capri, the *Project Capricorn* construct from Cyberpunk: Edgerunners season 2, lives on your desktop
and tells you what your coding AI is up to: **Claude Code**, **Codex** or **Antigravity**. She teleports,
glitches, comments on every action, comes to find you when it needs your permission, and loses it when the job is done.

![Capri telling you Claude is done](docs/done.png)

![Teleport, frame by frame](docs/teleport.png)

## What she does

- **When she starts**: she grabs your screen. Its edges crackle red, her left hand slams onto its edge, then her
  right, her arms reach in along them as she hauls herself up, and her face hits the glass (a white flash, an ink
  one, her colours apart, the screen shaking). She looks around, blinks, opens her mouth wide on "hi" (a tag pops
  by her face, her name typed under it), lets go of the right edge to wave at you with her clawed hand, grabs it
  again, glances at where she's going, and lets go: her arms break into shards from her hands in, and her head
  crouches and dives down to her spot, where her body unfolds from her face.

  ![Her intro: her hands on the edges, her face hitting the glass, the wave, holding on again](docs/intro.png)

- **While Claude works**: a ticker over her head shows the current action
  (`EDITS gigs.ts`, `RUNS npm test`, `GREPS "paginate"`…) and she sheds little data glyphs.
  When Claude runs a command or goes on the web, red sparks fly off her fingers; sitting on a window,
  she jacks into it and the lightning runs along its edge.
- **When Claude goes quiet mid-task** (thinking it over, or a slow local model): after 15 seconds the ticker turns
  violet and counts the seconds (`THINKING… 45 s`), and she keeps herself busy (a spin, a look around, the satellite
  once). After 40 seconds she says something about it; after two minutes she tells you nothing's stuck.
- **When Claude needs you** (permission, question): she teleports next to your mouse, mane bristling, and won't let it go.
  If you're on another window, she goes to Claude's window instead and points at it with her finger (a dashed line,
  brackets on its corners, `CLAUDE` on a tag): that's where the question is. She stops once you've answered.
- **When a command fails**: red impact frame, she gets knocked back, heavy glitch, and the error line that actually matters.
- **When it's done**: she teleports to the middle of the screen and goes into her victory sequence:
  a wind-up with her mane pulled in, a stretched smear frame, then arms flung up and mane exploding under
  manga speed lines and a shockwave, a manic laugh with an anime cut-in of her grin. Once she's back down,
  the summary (`12 actions · 3 files changed · 2m 14s`) and Claude's last sentence.
- **When Claude answers and you're on another window**: she shows you its whole answer, in a wider panel that
  scrolls (paragraphs, lists and code kept). It goes away when you're back on Claude's window, or when you click it.
  Claude's window is the one you typed your prompt in. Windows only, like the window tracking.
- **The rest of the time**: she floats, her mane sways and sheds shards, she drifts from one corner to another,
  turns around and cocks her head when your mouse comes near (or, little menace, zaps it with red lightning and a sly grin),
  looks up at the satellite, and falls asleep after 10 quiet minutes.
- **When she sleeps**: she dozes a while, then her mane and her body come apart and all that's left is what she is at
  heart in the show, her green mask and her eyes, floating where she was, eyes shut. Now and then she cracks one open.
  Bring your mouse close (or let Claude start again) and her blue eyes snap open and she comes back together around it.
- **The satellite**: the big sequence, kept for moments that matter. The first time of the day, a little while after
  Claude finishes a long job (8 minutes or more, or 50 actions), or whenever you like from the tray menu.
  The white specks of her mane lift off as a constellation, line up into a road from her fingers to the satellite,
  she coils up, and the red light goes up to it. It answers her, twinkling twice.

![Victory: the key pose, then the laugh and the cut-in](docs/victory.png)

![The satellite: her stars, the road, the red light, the answer](docs/star.png)

### Her character

She has moods that build up and wear off (`mood.js`): insult her and she gets angry (a string of insults and she
blows up: a red flash, her red copies flying off her, a growl, then a bolt at your pointer) and holds a grudge, even
across restarts, until you apologise (twice, if she was furious); compliment her and she gets flustered (a blush, a
little heart); make her laugh and she laughs; call her "Alexa" and she corrects you; tell her you're sad and she
softens. Poke her over and over and she loses it, sweep the pointer back and forth over her and she's ticklish, rest it
on her head for a head pat, drag her around and she gets dizzy, leave her alone and she gets bored. She reacts with
her body before her AI even answers, and her AI is told how she feels and why. Her mood shows on her panel and at the
top of her menu (her menu › Character › Emotions turns it off).

![Her moods](docs/moods.png)

- **Her voice** (her menu › Voice): her chat answers read out, or everything she says. The system's voices (free,
  offline, pitched by her mood), OpenAI (`gpt-4o-mini-tts`, told how she feels), ElevenLabs (your voice id), or any
  OpenAI-compatible speech server on your PC (Kokoro-FastAPI). Speech services go through her "many minds" effect:
  two delayed, wavering copies of her under her voice.
- **Her colours** (her menu › Colours, or "turn blue" in her chat): seven themes for her mane, her misregistered copy,
  the panel and her lightning, or *Follow her mood*.
- **Her own life** (`life.js`): when nothing's going on she hacks some corp's ICE, plays a tiny arcade game (and rages
  when she loses), reads a data shard, paints neon graffiti on your screen, scans your network, argues with the other
  minds in her. With music playing (Windows' media controls: Spotify, a browser…) she puts headphones on and bobs her
  head, has opinions about the track, and in DJ mode skips one herself now and then. She notices when you've been
  away, says good morning, tells you to go to bed at 3 am, complains when the battery runs low.

![Her colours](docs/themes.png)

![What she gets up to](docs/life.png)

### Her senses and her hands

All off by default — each is a live use of your screen, sound, mic, or keyboard, so you turn it on yourself (her menu ›
Senses / Hands), and while a sense is on a badge in the corner says so (◉ I SEE, ● MIC). Nothing is recorded, and
each thing only ever goes to the service you picked (a local one keeps it on your PC).

![She sees your screen, and types a message you confirm](docs/senses.png)

- **She sees your screen** (eyes.js, screen.js): now and then, and whenever you ask ("what's on my screen?"), she takes
  a small screenshot and reacts in character. She hides herself for the shot, the picture is never stored and goes only
  to the vision model you set (Ollama `qwen2.5vl`/`llava`, or a cloud model like `gpt-4o-mini`). Her chat knows what she saw.
- **She dances to your real music** (rhythm.js): she taps the system's loopback audio, finds the beat in the bass, and
  bobs, sways and spins in time — bigger when it's louder. Just the loudness and the beat; no title, no recording.
- **She hears you and talks back** (ears.js, stt.js): press **Ctrl+Alt+Space** (or the mic button) and talk; she writes
  it down and answers — out loud, if you gave her a voice, so you can talk hands-free. Recording stops on its own when
  you go quiet. Conversation mode keeps the mic open for back-and-forth. Transcription: Groq (free tier, good at Russian),
  OpenAI, or a whisper server on your PC.
- **Her hands** (hands.js, control.js — Windows): when you ask, she arranges windows (minimize, maximize, restore, bring
  to front, show the desktop) and writes messages in Telegram, Discord, WhatsApp or Slack. She types the message out but
  **never sends it until you confirm** — you see who it's for and what it says first — and she stops rather than type into
  the wrong window if focus slips. She never touches her own, Claude Code's or Ollama's windows.

![She dances to the beat](docs/dance.png)

### She gets to know you

On by default (her menu › Character › Learns about me), and it all stays on your PC (`bond.json` in her data folder).

![She grows closer and remembers who you are](docs/bond.png)

- **How you write**: message length, emoji, swearing, formal or casual, how often you laugh or ask things, the hours
  you're around. Counts and averages only; your messages aren't kept here. Write short and she answers short; swear out
  of habit (not at her) and she stops bristling at it.
- **How you take her answers**: you laugh, thank her, say "cool" after a short cheeky answer, and she leans that way;
  "nonsense", "boring", "that's wrong" and she leans away. Plain asks work at once and stick: "shorter", "tell me
  more", "no slang", "be serious", "be nicer", "roast me".
- **What you tell her about yourself**: every few messages (and when you close the chat) her own chat model writes a few
  lines in her notebook: what you do, what you like and don't, how you like to be talked to. Never passwords, phone
  numbers, addresses, card or document numbers, health or money (and a filter cuts them anyway). With Claude Code as her
  chat, no notebook: it works in your project.

The longer you're together, the closer she gets: **strangers → getting to know each other → friends → close → one of
us**. She tells you when it changes (♥), and it shows: a stranger gets questions about themselves, a friend gets teased
and reminded of what they said, someone close gets the truth even when it stings. Be rude to her all the time and she
won't let you close.

Ask "**what do you know about me?**", see it all in her menu (Character › What she knows about me…, with a button to
wipe it), or say "**forget everything about me**".

### Her circular menu

**Right-click her** and a ring opens around her, in her colours: pick a theme and the menu changes with her mane. Each
sector is a tab, shown as a card beside the ring (arrow keys switch, Esc or a click outside closes it):

![Her circular menu: the bond, and the mic with its live level](docs/ring.png)

- **Bond**: how close you two are (strangers → one of us), how far to the next level, since when you've known each
  other; four dials for how she is with you (shorter ↔ longer, slang, teasing, warmth) that she turns herself and you
  can turn by hand; and her notebook about you: facts, likes, dislikes, with a ✕ to take back anything wrong and a way
  to write one yourself. "Forget everything about me" is in the same card.
- **AI**: who answers her chat and how it's connected (see "Talk to her"): Claude by API key, Claude Code, Ollama and
  other servers on your PC, the cloud services, your own server; the key, the model list, a connection test, the wizard.
- **Mic**: on/off, which microphone (it reopens on the new one), how sensitive (the line on the meter is where "voice"
  starts), a live waveform and level (the mic is open only while this tab is on screen and the badge by the clock blinks
  to say so), press-to-talk or conversation mode, and whether the badge shows the level too.
- **Voice**: when she talks, her engine, volume and mute, and **where the sound goes**: pick the speakers or the
  headphones (her blips, sounds and a speech service's voice follow; Windows' own voice always plays on the default
  device), with a test sound, and **hear my microphone** to check it on the device you picked (the mic stays open, with
  the badge blinking, only while that tab is on screen; use headphones, speakers can whistle).
- **Senses**, **Character**, **Colours**, **More** (size, language, where she rests, teleport, the satellite, put her
  away): the same settings as the tray menu, which is still there (More › System menu…). **Talk** opens her chat.

### She rests lightly

Asleep (down to her mask) or put away in her chip (Ctrl+Alt+C), she costs next to nothing: she's drawn on a timer and
only when something changes (a few frames a second, not every refresh of a 60–144 Hz screen), the PowerShell helpers
watching your windows and music stop, she checks on you less often, her audio naps after 20 s of silence and the beat
listener pauses. In our measurement her window's work while asleep dropped **4–5×** and screen-frame wake-ups
**30–100×**. Anything that calls her (a click, Claude, her menu, the shortcut) brings it all back at once. Awake, she's drawn
on twos (12 drawings a second, like the anime) and doesn't wake the CPU in between.

**Updates are lean too.** A setting set to what it already is does nothing (no file, no message, no menu rebuild); a
burst of changes (a slider in her ring) is one write to `config.json`, whole or not at all; the tray menu is rebuilt at
most every 0.12 s; her chat's tokens go to the overlay in groups instead of one message each; a cloud service's model
list is remembered for a minute; the regular expressions that read your messages are warmed up while she's idle, so
the first message doesn't stall for ~150 ms. The installer carries only the fonts she uses (`assets/fonts`) and none of
the SDK's maps or typings.

### She gets around

- **She sits on your windows**: perched on the top edge of a window, legs dangling and kicking one after the other.
  She rides along when you move the window, and falls off when you close, minimize or cover it.
  While Claude works she settles on the window in front if she can.
- **She peeks in from the edges of the screen**: half hidden on the left or right, or hanging upside down from the top.
  She's shy: get your mouse close and she ducks away to another edge.
- **She falls**: stretched, mane blown up, accelerating, then a big squash and a shower of shards when she lands.
  On the way down, a window ledge can catch her.
- **Drop her on a window**: drag her and let go with her hips on a window's top edge, she sits there.
  Let go anywhere else and she falls.
- **She possesses your windows**, like in the show where she slips into bodies and systems: now and then she dives
  into the window she's sitting on. Red lightning races round its frame, slices of it glitch, and the window looks
  at you with her eyes and her zigzag grin, more eyes opening all over it, every pupil on your pointer, and she laughs.
  Then she comes out of another window. Nothing is drawn over the windows in front of it, and the window's contents
  are never read: it's just drawn over, for two seconds. If it bothers you, untick *Possess my windows* in the tray menu.
- **Little flourishes**: a full spin with afterimages, a hop, looking left and right, the cocked head,
  and the other minds in her (her green and red copies) pulling away from her, hanging there, and snapping back in.

![Sitting on a window](docs/sit.png)

![Peeking in from the edges](docs/peek.png)

![Possessing a window: the dive, the hit, the window full of eyes](docs/possess.png)

![Asleep down to her mask, waking up, and put away bottom left](docs/sleep.png)

Window tracking is Windows-only for now (a tiny PowerShell helper reads window positions, no titles, no contents).
On macOS and Linux she still floats, peeks, falls and wanders.

### She shows you around

**How does it work?** in her menu: she asks what to show you, then takes you there and points at it. Her head snaps
to it, she coils up leaning away, then strikes: her construct arm shoots out at it to twice its length, red lightning
off her fingertip, a reticle slams onto it with two of her eyes opening on its corners, and a close-up of her eyes cuts
in. Then she holds it while she explains, a wire of data running from her finger to it: now and then she jabs at it,
or glances back at you. When she's done, the wire reels back into her finger and the arm snaps back.

![The strike, and the hold while she explains](docs/point.png)

- **Where's my icon?** She goes down by the clock and points at her tray icon, or at the **^** when Windows hides it.
- **Where's Claude?** She points at Claude's window: the one you typed your last prompt in.
- **Claude's folder**: she opens `~/.claude` in Explorer with `settings.json` selected, points at the window, and
  explains what her hook in there is and how to take it out.
- **Plug me into Claude**: her hooks in one click. It's also her welcome the first time she starts. Next to it,
  **Free with Ollama** runs Claude Code (or Codex) through Ollama for you: her hooks go in, Ollama gets installed if it
  isn't, and a window opens on `ollama launch claude`, where you pick a model.
- **Talk to me**: see "Talk to her" below.

She pulls faces while she talks: eight expressions, all frames of her from the show (watching, turned away, the fang
grin, eyes gone round, looking right at you, laughing with her mouth wide open, all her eyes at once, the zigzag grin).
Each message picks the one that fits, and her portrait glitches from one face to the next.

![Pointing at Claude's window during a permission prompt, and at her tray icon](docs/guide.png)

![Her eight faces](docs/faces.png)

### Her mission report

**Mission report** in her menu: a card of what Claude got through today, made to be screenshotted. Tasks finished in
big, then actions, files changed and errors, the longest mission and its project, prompts, approvals and projects. The
numbers count up. **Copy image** puts a picture of the card on your clipboard, on its own dark plate, ready to paste
anywhere. In the evening (after 6 pm), after a real day's work (3 tasks or more), she brings it to you once, on her
own. The demo doesn't count, and it stays on your PC, one day at a time.

### Talk to her

**Talk to her** in her menu (or the **Talk to me** button when you click her and nothing's going on): you type in her
panel and she answers in character. She knows what Claude is doing and what it got done today. She answers in writing,
in her own language. Enter sends, Esc closes.

The first time, she sets it up with you, with buttons, no terminal:

- **On my PC** (free, nothing leaves your machine): she installs [Ollama](https://ollama.com) for you (with winget,
  Windows' own installer), wakes it up, and downloads a model while a bar fills up: gemma3 (3.3 GB, better in languages
  other than English) or llama3.2 (2 GB, for smaller PCs). On a tiny model (1B and under) she warns you it may talk
  nonsense and offers a better one.
- **Online, no account**: Pollinations, nothing to set up.
- **I have a key**: **Claude** (the Anthropic API), Groq or Gemini (both have a free tier), OpenRouter, OpenAI, Mistral
  or DeepSeek. You paste your key in her panel and she checks it. It's kept on your PC, encrypted with your Windows
  account, and only ever sent to that service.

**Connecting a model, in her ring menu.** Right-click her › **AI**: whether she's connected, who answers her (Claude,
Claude Code, on this PC, in the cloud, your own server), a field for the key, **Test the connection**, the model list and
the setup wizard. Switching is instant, no restart. She tells you plainly when a key is refused, the account is out of
credit, a service is overloaded or a model declined.

![The AI tab: who answers her, the key, the model](docs/ai.png)

**Claude (API key)** is built in through Anthropic's official SDK (`src/main/anthropic.js`): answers stream in as they
are written, the model list comes from your account (Claude Opus 5.5 by default: it holds her character best; Sonnet
5.5 and Haiku 5.5 are cheaper and faster), her replies run at low effort so she doesn't keep you waiting, and where the
API offers it a declined request is re-run on another model so she doesn't fall silent. Her eyes work on Claude too. Get
a key at [console.anthropic.com](https://console.anthropic.com/settings/keys) (billed separately from a Claude
subscription), paste it in the AI tab, **Connect**. With `ANTHROPIC_API_KEY` set, or after `ant auth login`, press
**Use the system one** and there's nothing to paste.

**Claude Code** (a subscription, no API key): your messages go to `claude -p` in the folder you pick, continuing one
conversation, and her hooks show what it does. Permission mode `default` only lets it read (nobody is there to say yes);
`acceptEdits` lets it edit files without asking (tray menu › AI model).

Her tray menu › **AI model** has the same choices (LM Studio `:1234`, llama.cpp or vLLM `:8080`, any OpenAI-compatible
server: **API key or address…**). **Forget our conversations** clears what she remembers of your chats.

**It's AI.** Her replies are written by the model, not by the show's writers: it's a fan version of her, and the chat
panel says so every time.

**What she can do on your PC** (Windows), when you ask her in the chat:

- **Open an app or a game**: anything in your Start menu (Store apps like Spotify included), your Steam and Epic
  games ("open Spotify", "launch Brawlhalla"). Named in your own words, it opens right away; if only her AI came up
  with it, you get a button first.
- **Music**: "pause", "next", "louder", "mute"… press the media keys, so it works with Spotify and most players, right
  as you send it. "Put Daft Punk on Spotify" opens Spotify on a search for it (the app if you have it, else the site).
- **A website**: always behind a button showing where it goes.
- **Close an app** ("close AM Music", "can you shut Discord down?"): a button with the app's name, and nothing happens
  until you click it. She closes it the way its own close button does, so it can still ask you to save. If it only
  hid in the tray, she offers **Force quit**, again only on your click (unsaved work is lost then). She never closes
  Windows' own pieces, Claude, Ollama or herself.

Nothing else: she can't see your screen or your files.

### Make her yours

Right-click her › **Make her yours…** (or "Make me yours" in her guide), one panel at a time, each one skippable:

- **What she calls you.** She uses it now and then, and comes online with it ("Capri online. Hi, Max.").
- **How she is**, in your words ("more teasing, and talk to me about Night City"): her chat follows it. She stays Capri.
- **Lines of yours**, that she says now and then with hers when you click her. Write `{name}` in one and she puts
  your name there.
- **Things to remember** (your favorite game, your cat, D…): her chat keeps them in mind.

In her chat, "call me Léa" and "remember that my cat is called Neko" work too. All of it stays in her settings on
your PC.

She only catches the mouse on her actual body (pixel-precise): the rest of the screen works as usual.

- **Click** her: she tells you where Claude is at (nothing going on: a **Talk to me** button, to chat with her).
- **Drag** her: move her around.
- **Click** the panel: it closes.
- **Ctrl+Alt+C**: she puts herself away (into her biochip, like in the show) and all that's left of her is her mask,
  eyes shut, in the bottom-left corner. Her eyes only open when Claude needs you. Click the mask (or Ctrl+Alt+C again)
  to bring her back.
- **Her menu**: right-click her (it's also on her tray icon, next to the clock): teleport, look at the satellite, demo,
  how it works, mission report, talk to her, size, sound, screen, AI model, wander, possess your windows,
  language, start with Windows, hooks.

She speaks **French, English, Spanish, Brazilian Portuguese and Russian**, and picks the language of your system on her
own. You can choose another one in her menu.

## Install

### Quick start (Windows, no coding)

1. Download **`Capri-Setup-x.y.z.exe`** from the [latest release](https://github.com/mochiiwuff/capri-desktop/releases/latest)
   and run it. It installs for your user only (no admin rights), adds a desktop shortcut and starts Capri.
   You don't need Node.js or anything else.
2. The installer isn't signed (a code-signing certificate costs money), so Windows SmartScreen may say
   "Windows protected your PC": click **More info**, then **Run anyway**.
3. Capri shows up and introduces herself. Click **Plug me in**: that connects her to Claude Code.
4. Close Claude Code completely and open it again (it reads its hooks when a session starts). As soon as Claude does
   something, she tells you **"I can see Claude!"**: that's how you know it worked.

Her menu: **right-click her**. It's also on her tray icon, which Windows 11 often hides behind the **^** next to the clock.

### What's Claude Code? Do I need it?

[Claude Code](https://code.claude.com/docs/en/quickstart) is Anthropic's coding assistant: in a terminal, in VS Code,
or in the Code tab of the Claude app. It needs a paid Claude plan (Pro or higher) or an API account. Capri only watches
it: no API key, and nothing to pay for Capri herself.

Without Claude Code she still lives on your desktop: she floats, sits on your windows, looks at the satellite, falls
asleep. You can just leave her there.

### From the source (macOS, Linux, developers)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
git clone https://github.com/mochiiwuff/capri-desktop.git
cd capri-desktop
npm install
npm start
```

Keep that terminal open while she runs. Not tested on macOS or Linux yet: she should start, but the window tricks
(sitting on your windows, possessing them, showing Claude's answer when you're elsewhere) are Windows-only, and on Linux
the transparent overlay works best on X11 (Wayland can struggle with click-through windows).

### Hook her up to Claude Code by hand

Right-click Capri, then **Install Claude Code hooks**. Or from the command line:

```bash
npm run hooks:install
```

This adds a hook to `~/.claude/settings.json` (a backup is written next to it, your existing hooks are kept).
Restart your Claude Code sessions afterwards. To remove it: `npm run hooks:uninstall`.

The hooks run `async`: they never slow Claude down, and when Capri isn't running they do nothing.

### Codex or Antigravity instead of Claude Code

Right-click her › **Watch** › **Codex** or **Antigravity**. She says hi and offers to plug herself in, like she does
for Claude Code. Then:

- **Codex**: restart it and trust her hooks when it asks. They go in `~/.codex/hooks.json`. Her hook for Codex needs
  [Node.js](https://nodejs.org) 20 or newer on your PATH.
- **Antigravity**: start a new conversation. Her hooks go in `~/.gemini/config/hooks.json`.

She follows one of them at a time, the one picked in her menu, and her lines, her guide and her chat use its name.
She only watches: when Codex or Antigravity asks for approval, you still answer it there. From the command line:
`npm run hooks:codex:install` or `npm run hooks:agy:install` (`:uninstall` to remove them), and `npm run test:hooks`
runs the tests of both adapters. **Watch** › **Nothing, just keep me company**: she stops talking about any of them.

### Try it without Claude

```bash
npm run demo
```

Replays a fake session from start to finish (reads, a web fetch, a subagent, writes, a failing test, a permission
prompt, the end), then shows everything she does on her own, a line before each trick: the other minds in her,
zapping your pointer, the whole satellite sequence, possessing a window (a little terminal opens for her, then closes
under her and she falls), sleeping down to her mask, and putting herself away in the bottom-left corner.
It's also in the tray menu, in her language; from the command line it's in English, or add one: `npm run demo -- fr`
(or `es`, `pt`, `ru`).

## Sounds

Every sound is synthesized live (Web Audio), nothing copyrighted ships with the repo.
You can drop your own files in the custom sounds folder (tray › Sound › *Open custom sounds folder*),
named like this (`.mp3`, `.wav`, `.ogg` or `.m4a`):

| File | When |
|---|---|
| `teleport-out` | she vanishes |
| `teleport-in` | she reappears |
| `done` | Claude is done |
| `alert` | Claude is waiting for your permission |
| `error` | a command failed |
| `hello` | a session starts |
| `star` | she looks up at the satellite |
| `land` | she lands after a fall |
| `rise` | the launch into her victory pose, the red light going up |
| `bolt` | her red lightning |
| `charge` | charging up before the red light goes up |
| `possess` | the window she took over laughs |
| `blip` | every syllable while she talks |
| `tick` | a quiet reminder |

## Is it safe?

- All of the code is right here. The installer is built from it with `npm run dist`; you can build your own.
- Nothing leaves your PC (see below): she only talks to Claude Code through a hook on `127.0.0.1`.
- What she changes on your system: the hook in `~/.claude/settings.json` (a backup is written first, and you can remove
  it from her menu), and a startup entry only if you tick "Start with Windows". She uninstalls like any app, from
  Windows Settings › Apps.
- The SmartScreen warning comes from the installer not being signed, not from anything it does.

## FAQ

- **Mac, Linux?** No installer yet, but you can run her from the source (see above).
- **Phone, Android?** No, she needs a desktop.
- **Other assistants?** Claude Code, Codex and Antigravity: her menu › **Watch**. Cursor, Windsurf and Gemini CLI: not yet.
- **Ollama?** Two ways. Claude Code running on a local model through Ollama (`ollama launch claude`): she sees it like
  any Claude Code, it's just slower, and her ticker counts the seconds while it thinks. And she can chat with you
  through Ollama herself: see "Talk to her".
- **She barely moves, her intro just fades in and out.** Windows has its animations turned off (Settings ›
  Accessibility › Visual effects › Animation effects), and she follows it. Her menu › **Animations** › **Full** makes
  her move anyway; the first time, she asks.
- **A black screen behind her.** Some PCs show her see-through window black (often NVIDIA cards with FXAA, MFAA or
  HDR on; other overlay apps like Desktop Mate do it too there). Right-click her, or her icon by the clock › **Display**
  › **OpenGL**: she restarts drawn another way. Still black? **Without the graphics card**, which costs a bit more CPU.
  Turning off FXAA and MFAA in the NVIDIA Control Panel can fix it as well.
- **Can I turn her off?** Ctrl+Alt+C puts her away, **Quit** in her menu closes her. Claude Code works exactly the same
  without her.
- **She only floats around and says idle things.** That's normal until Claude Code does something. If it never reacts,
  check her menu says "Claude Code hooks: installed", then close Claude Code completely and open it again.

## What leaves your machine

Nothing. The hook only keeps what the display needs (tool name, file path, command, the start of your prompt,
Claude's last message up to 6,000 characters so she can show it to you, all truncated) and sends it to `127.0.0.1` only.
Your file contents are never sent: for a write, only its size goes through.

Her chat goes to whoever you picked to answer her: Ollama on your PC (`127.0.0.1:11434`, or `OLLAMA_HOST`) keeps it
here; Claude (the Anthropic API) or another cloud service gets your messages and what she knows of the moment (the
project's name, Claude's last action, today's counts). Your API keys are kept encrypted with your Windows account and
only sent to their own service. Her mission log stays in her own storage on your PC.

Her voice, if you pick a speech service for it (OpenAI, ElevenLabs): what she says goes to that service, nowhere else
(the system voice and a server on your PC keep it here). What's playing (title and artist) is read on your PC and only
ever goes into her chat's prompt, so she can talk about it. Her moods, grudges and what she's been up to stay in her
own storage on your PC.

Her senses, when you turn them on: a screenshot goes only to the vision model you set (a local one keeps it here) and
is never stored; your voice goes only to the transcription service you set (a server on your PC keeps it here) and the
recording is never stored; the system audio she dances to is processed locally (loudness and beat only) and never
recorded or sent. Her hands run entirely on your PC and send nothing anywhere.

What she learns about you (your style, what you like from her, her notebook) stays in `bond.json` on your PC. Her
notebook is written by the chat model you already talk to her with (a local one keeps it all here); turn it off in her
menu › Character.

## Art direction

The goal: she should feel like she stepped out of the anime, not like a widget.

- **Cel animation**: her body is redrawn 12 times a second ("on twos") like anime, 24 during teleports.
  Every drawing has a slight *boil* (the wobble of a line redrawn by hand).
- **Frame by frame, pose to pose**: nothing is tweened. Each move is an exposure sheet (`acting.js`):
  key drawings held for a few frames, an anticipation the other way, a smear frame with multiples of
  the head, an overshoot, holds. Her idle float is four drawings, not a sine wave.
- **She acts with her head and her mane**, like in the show: the cocked head, the shards bristling or
  blowing wide, the manic laugh with the head shaking on every drawing, the slump when she sleeps.
  The cut-out is rigged so her head tilts around the neck, her mane flares unevenly around a rigid face,
  and her thighs fold (foreshortened, seen from the front) so she can sit with her lower legs swinging.
- **Squash and stretch, afterimages**: the flat cut-out squashes to a sliver to turn around, stretches when
  she falls, flattens when she lands, and splits into green and red copies (the other minds in her) when she spins or laughs.
- **The satellite**, after the season's ending, where she points at the light in the sky and wonders if they
  could make it up there: a point of light crosses the top of the screen, slowly. Most of the time she just looks,
  reaches, it twinkles, she sighs. The first time of the day, and a little while after a long Claude job, it's the
  whole sequence, in five beats (and nothing distracts her meanwhile, not even your pointer):
  1. **Hush**: she freezes, and the white specks of her mane lift off into a constellation over her.
  2. **The reach**: she reaches out (the drawings bunch up as the hand gets there) and her stars line up into a road
     from her fingertips to the satellite.
  3. **Anticipation**: she coils up, the arm pulls back a little, sparks crawl in her hand, cut-in on her eyes.
  4. **The red light goes up**: a heavy tapering bolt races up in three drawings, the first one in negative (an impact
     frame), the stars light up as it passes, speed lines on the satellite, and she's lifted with it.
  5. **The answer**: the bolt snaps and the pieces fall. A beat of silence, then the satellite twinkles twice.
     Her stars come home, her mane flares bright for a moment, and her hand drops with a sigh.
- **Her arms grow when she aims**: anime exaggeration, or a raised arm would get lost in her mane. It stretches
  along its length only (it stays as thin) and no longer gets bent by the head and the mane.
- **Both arms match**: the cut-out had one arm reaching and one hanging. The hanging one is removed
  (`tools/build-sprite.py`) and the shader draws the reaching arm mirrored in its place, so both hands are the
  same claws and both arms can act. Where an arm crosses her body or her mane it gets a violet line, so it reads.
- **Her texture**: the red mane is pushed back to the show's hot red and covered in twinkling white specks.
  Shards come loose from it and drift away.
- **The violet offset**: like in the anime, a misregistered violet copy under her, under the panel, under the shards.
- **"Relic" glitch**: shifted horizontal slices and RGB split, in the spirit of Johnny Silverhand's appearances.
- **Teleport**: charge, shards, collapse into a line, and where she was, a black slit with a red line in it,
  like in the show. A red column of light to the sky, a bolt to the destination, her pieces (mane shards and the
  green stars of her eyes) spiralling back in, back with two *impact frames*.
- **Her intro**: a close-up of her, cut out so your desktop shows around her mane (`tools/build-intro.py`), in six
  drawings swapped like cels (at rest, her mouth ajar, half open and wide open for "hi", her hand tilted one way and
  the other for the wave, on threes), and everything else is animation on top: impact frames (her as a flat white then ink silhouette), an RGB split that
  settles, screen shake, the line boiling on twos, her eyes redrawn over the picture's so they can look around and
  blink, the camera creeping in, the tag slamming on. Never a straight edge of the picture on screen: it shows
  through jagged cuts that move (her arms from the sides in, then breaking off from the hands in, then just her
  head for the dive, with afterimages and her zigzag).
- **Cut-ins**: close-ups of her taken from the show, pushed in, with speed lines: her grin or her laugh after a
  finished job, all her eyes when Claude is waiting on you, her eyes right before the red light, her sideways look
  after zapping your pointer. Her face in the panel changes with what she's saying, too.
- **Her mask**: a vector drawing after the show (and the "Capri Wink Face"), on its own small canvas, only redrawn
  while on screen: the green slab of a face, the hooked spike, the white fang, the blue almond eyes,
  and the eyes shut as chevrons while she sleeps.
- **Type**: Chakra Petch (bevelled cuts, like her shards) + JetBrains Mono for data.

If Windows is set to "Show animations: off", she sticks to fades.

## How it's built

```
hooks/capri-hook.js      run by Claude Code, reads the event on stdin and posts it to the app
scripts/install-hooks.js adds / removes the hook in ~/.claude/settings.json
tools/build-sprite.py    rebuilds the sprite from the original cut-out (Python + Pillow, only if you change it)
tools/build-cutins.py    cuts the cut-ins and her faces out of frames of the show
tools/build-intro.py     cuts her intro's close-ups out of their background, all the same way
src/main/                Electron: full-screen transparent click-through window, tray, local HTTP bridge
  windows.js / .ps1      where the other windows are (Windows only), so she can sit on them
  ollama.js              her chat: the local model, through Ollama
  apps.js                closing an app you asked her to close (after your click)
src/renderer/js/
  sprite.js              WebGL shader: head tilt, mane flare, sitting, smears, afterimages, colors, glitch
  acting.js              the exposure sheets: every move, drawing by drawing
  capri.js               the character: stances, teleport, sitting, peeking, falling, drag, sleep
  fx.js                  shards, light columns, bolts, glyphs, speed lines, shockwaves, the satellite and the red light, possessed windows, the cut-ins, her intro
  panel.js               the "transmission" panel, her faces, and the ticker
  guide.js               her guide: the tutorials, going to things and pointing at them
  brain.js               turns Claude events into lines and actions
  mission.js             today's mission log, for her report card
  chat.js                talking to her: the conversation, who she is, her answers coming in
  lines.js               what she says (FR / EN / ES / PT / RU)
  chip.js                her mask: while she sleeps, and bottom left when you put her away
  voice.js               the sounds
  mood.js                her feelings: what a message does to her, how long it lasts, her grudges
  heart.js               her feelings on her body, her face, her colours, her voice; poking, tickling, head pats
  life.js                what she does on her own, the music, noticing you
  themes.js              her colours
  speech.js              her voice: the system's, or a speech service through her many-minds effect
  eyes.js                when she looks at your screen, reading the vision model's answer, reacting
  rhythm.js              the beat: system audio -> beat detector -> she dances
  hands.js               reading window/message commands, and the confirm-before-send flow
  ears.js                the mic, recording, silence detection, conversation mode
  fx-life.js             her moods' marks and her activities' props
  bond.js                she gets to know you: your style, how you take her answers, her notebook, how close you are
  ring.js                her circular menu: the ring, where it goes on screen, tabs
  ring-tabs.js           what's on each card: Bond, Mic (level meter, device, sensitivity), Senses, Colours...
  ring-ui.js             its switches, sliders, chips (styles/ring.css, on her colour tokens)
  brain-providers.js     who can answer her chat, grouped, and which take a key (the AI tab)
src/main/anthropic.js    Claude through the official SDK: streamed answer, models, vision, refusal fallback
src/main/llm.js          every "brain": Ollama, Claude, Claude Code, OpenAI-compatible servers
src/main/config.js       her settings: no-op changes skipped, one atomic write per burst
src/main/tts.js          speech services (OpenAI, ElevenLabs, OpenAI-compatible)
src/main/stt.js          speech-to-text (Groq, OpenAI, OpenAI-compatible)
src/main/screen.js       a screenshot (desktopCapturer); llm.js see() runs the vision model
src/main/control.js      her hands: windows and messages via PowerShell, focused on the right window only
src/main/media.js / .ps1 what's playing, from Windows' media controls
```

Tests: `npm test` runs them all (`test:character`, `test:senses`, `test:bond`, `test:ring`, `test:claude`, `test:config`,
`test:hooks` one by one). The Claude connection is tested against a stand-in for the Anthropic API, with the real SDK, so
no key or network is needed.

To hack on it: `npm run dev` turns on debug routes on the bridge (`/debug/capture` saves a frame of the window to `captures/`,
`/debug/testwin` opens test windows she can sit on, one per name, `/debug/mouse` moves and clicks a stand-in pointer
over Capri's window, without touching the real one, `/debug/type` types in her chat).
`npm run dist` builds the Windows installer in `dist/`.

## Credits and rights

Capri / Project Capricorn, Cyberpunk and Cyberpunk: Edgerunners belong to CD PROJEKT RED, Studio Trigger and Netflix.
This is a non-commercial fan project with no affiliation. The character images in `assets/capri/` come from frames of
the show, a fan-made cut-out and fan art (her intro's close-ups); they are **not** covered by the code's MIT license.
If a rights holder wants them removed, open an issue.

Fonts: Chakra Petch and JetBrains Mono, under the SIL Open Font License, via Fontsource.

