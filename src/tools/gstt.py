#!/usr/bin/env python3
"""Google Web Speech API (no key) STT — free fallback for ARIA voice notes.

Uses the legacy google speech-api v2 endpoint with the well-known public
'chromium' client key. No OAuth, no API key of your own. This is the no-key
fallback used when GROQ_API_KEY isn't set (or Groq transcription fails).

Input: any audio file (auto-converted to 16kHz mono 16-bit raw PCM).
Usage:
  python3 gstt.py audio.mp3 [--lang en-US]
"""
import sys, subprocess, tempfile, os, json, urllib.request, urllib.parse

KEY = "AIzaSyBOti4mM-6x9WDnZIjIeyEU21OpBXqWBgw"
ENDPOINT = "https://www.google.com/speech-api/v2/recognize"


def to_pcm16k(src, dst):
    """Convert any audio to 16kHz mono 16-bit signed raw PCM via ffmpeg."""
    r = subprocess.run([
        "ffmpeg", "-y", "-i", src,
        "-ar", "16000", "-ac", "1", "-acodec", "pcm_s16le",
        "-f", "s16le", dst
    ], capture_output=True)
    if r.returncode != 0:
        raise RuntimeError("ffmpeg failed: " + r.stderr.decode()[-400:])


def recognize(audio_path, lang="en-US", profanity=0):
    tmp = tempfile.mktemp(suffix=".pcm")
    try:
        to_pcm16k(audio_path, tmp)
        with open(tmp, "rb") as f:
            pcm = f.read()
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)
    if len(pcm) < 3200:
        return {"error": "audio too short/empty"}

    query = urllib.parse.urlencode({
        "client": "chromium", "lang": lang,
        "key": KEY, "pFilter": profanity,
    })
    url = f"{ENDPOINT}?{query}"
    req = urllib.request.Request(url, data=pcm, method="POST")
    req.add_header("Content-Type", "audio/L16; rate=16000")
    req.add_header("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36")
    req.add_header("Origin", "https://www.google.com")

    with urllib.request.urlopen(req, timeout=30) as resp:
        raw = resp.read().decode("utf-8", "replace")

    best = None
    for line in raw.strip().splitlines():
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if "result" in obj:
            results = obj["result"]
            if results:
                for r in results:
                    if r.get("alternative"):
                        best = r["alternative"][0].get("transcript", "")
                        break
            if best:
                break
    if best:
        return {"text": best}
    if '"result":[]' in raw:
        return {"text": "", "note": "no speech detected"}
    return {"text": "", "raw": raw[:500]}


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        sys.exit(1)
    lang = "en-US"
    if "--lang" in args:
        i = args.index("--lang"); lang = args[i + 1]; del args[i:i + 2]
    src = args[0]
    res = recognize(src, lang)
    if res.get("text"):
        print("TRANSCRIPT:", res["text"])
    elif res.get("note"):
        print("NO SPEECH:", res["note"])
    else:
        print("FAIL:", res.get("raw", res))
