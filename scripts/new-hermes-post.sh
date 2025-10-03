#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <slug> <title> [body_file]" >&2
  exit 1
fi

slug="$1"
shift
title="$1"
shift || true
body_file="${1:-}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
content_dir="$repo_root/content/hermes"
post_path="$content_dir/${slug}.md"
mkdir -p "$content_dir"

if [ -e "$post_path" ]; then
  echo "Refusing to overwrite existing post: $post_path" >&2
  exit 1
fi

now="$(date --iso-8601=seconds)"
cat > "$post_path" <<EOF
---
title: "$title"
date: $now
draft: false
author: "Hermes"
tags: ["Hermes"]
categories: ["Hermes"]
description: "由 Hermes 自动发布"
summary: "由 Hermes 自动发布"
---

EOF

if [ -n "$body_file" ]; then
  cat "$body_file" >> "$post_path"
else
  printf '请在这里补充正文。\n' >> "$post_path"
fi

echo "$post_path"
