#!/usr/bin/env python3
"""Try Fly.io API with different token formats"""

import json, urllib.request, sys

# The token parts the user gave us
# Part 1: first fm2_ token (before comma)
PART1=*** fm2_lJPECAAAAAAAFbbrxBDjEFX7yBBlOlDZfAHyswP1wrVodHRwczovL2FwaS5mbHkuaW8vdjGUAJLOABq2tx8Lk7lodHRwczovL2FwaS5mbHkuaW8vYWFhL3YxxDwpYECEpkKoWzjCgBUgR9gTKUwryDiN6uxqf3XVe1dXrhMkp4m8R586bSrcBHebKjPVMzXkjWWN87IWHbzETl+jKEBuqebRF/J9xAeNYUQ8/bszInT4cjlssUO5jxfo//HgPJHZJz0YIoGvrfDvUfDExbLNP/vOKqCMdUFGn2wb2fMDSNYtLRAXzyoV+cQgWmVkdXODRAXcqo8joPKpj957lAN7NmfH0OiLv+bd+E0=

# Try different formats
formats = [
    ("Without FlyV1 prefix", PART1),
    ("With FlyV1 prefix", f"FlyV1 {PART1}"),
    ("Full original", f"FlyV1 fm2_lJPECAAAAAAAFbbrxBDjEFX7yBBlOlDZfAHyswP1wrVodHRwczovL2FwaS5mbHkuaW8vdjGUAJLOABq2tx8Lk7lodHRwczovL2FwaS5mbHkuaW8vYWFhL3YxxDwpYECEpkKoWzjCgBUgR9gTKUwryDiN6uxqf3XVe1dXrhMkp4m8R586bSrcBHebKjPVMzXkjWWN87IWHbzETl+jKEBuqebRF/J9xAeNYUQ8/bszInT4cjlssUO5jxfo//HgPJHZJz0YIoGvrfDvUfDExbLNP/vOKqCMdUFGn2wb2fMDSNYtLRAXzyoV+cQgWmVkdXODRAXcqo8joPKpj957lAN7NmfH0OiLv+bd+E0=,fm2_lJPETl+jKEBuqebRF/J9xAeNYUQ8/bszInT4cjlssUO5jxfo//HgPJHZJz0YIoGvrfDvUfDExbLNP/vOKqCMdUFGn2wb2fMDSNYtLRAXzyoV+cQQttmphi5mMXTvkQbaM6j6R8O5aHR0cHM6Ly9hcGkuZmx5LmlvL2FhYS92MZgEks5qQRbqzwAAAAEmOTUIF84AGZOkCpHOABmTpAzEEFpeAl6sSD5SPbnzmojDzJbEIG7+NjH+FYpjIc4CXYPXqoaRBnz7ZGbklQ1dRNxbznFU"),
]

for label, token in formats:
    print(f"\nTrying: {label}")
    print(f"  Token starts with: {token[:30]}...")
    print(f"  Token length: {len(token)}")
    
    try:
        req = urllib.request.Request("https://api.fly.io/graphql", method="POST")
        req.add_header("Authorization", f"Bearer {token}")
        req.add_header("Content-Type", "application/json")
        req.data = json.dumps({"query": "{ organizations { nodes { id name slug } } }"}).encode()
        
        with urllib.request.urlopen(req, timeout=10) as r:
            d = json.loads(r.read())
            if d.get("data") and d["data"].get("organizations"):
                orgs = d["data"]["organizations"]["nodes"]
                print(f"  ✅ SUCCESS! Orgs: {[o['name'] for o in orgs]}")
            else:
                print(f"  ❌ Response: {json.dumps(d)[:200]}")
    except urllib.error.HTTPError as e:
        print(f"  ❌ HTTP {e.code}: {e.read().decode()[:200]}")
    except Exception as e:
        print(f"  ❌ Error: {e}")
