# Pi + Ollama in Docker: Cheat Sheet

## Preamble: models and choices

**Setup:** Pi (terminal coding agent from Earendil Works) runs inside a throwaway Docker container and uses local models served by Ollama on a MacBook Pro (M4 Pro, 48 GB).

**Models**

- `inkling-2-mini:26b-a5b-nvfp4` (default, 20 GB): Mixture-of-Experts model from Thinking Machines Lab, 26B total / ~5B active parameters. Fast on Apple Silicon, reported to beat Qwen3.8-27B on coding, and supports the tool calling Pi relies on.
- `qwen3.8:27b-mlx` (backup, 18 GB): dense 27B model. Slower, but a useful second opinion when the main model gets stuck.
- Each model needs 18–21 GB, so 48 GB holds one comfortably, two at most.

**Why this setup**

- **Ollama runs on the Mac, not in Docker:** Docker on macOS has no GPU access; native Ollama uses the Apple GPU for full speed.
- **Pi runs in a container:** Pi asks no permission before running commands and acts with your user's access. The container limits it to the mounted project folder.
- **Config lives on the Mac (`~/pi-docker/agent`):** models, settings and extensions survive between sessions and can be edited without rebuilding.
- **`--rm`, non-root user, `--ignore-scripts`:** every session starts clean, Pi runs without admin rights, and npm packages can't run install scripts.
- **Still exposed:** everything inside the mounted project folder, and the container's internet access. Use git to keep changes reversible.

## Commands

```bash
# 1. Homebrew (skip if installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Ollama: install, start as background service, pull models
brew install ollama
brew services start ollama
ollama pull inkling-2-mini:26b-a5b-nvfp4
ollama pull qwen3.8:27b-mlx

# 3. Docker Desktop (wait for the whale icon to stop animating)
brew install --cask docker
open -a Docker
docker --version

# 4. Dockerfile
mkdir -p ~/pi-docker/agent
cd ~/pi-docker
cat > Dockerfile << 'EOF'
FROM node:22-bookworm
RUN apt-get update && apt-get install -y git ripgrep && rm -rf /var/lib/apt/lists/*
RUN npm install -g --ignore-scripts @earendil-works/pi-coding-agent
USER node
WORKDIR /workspace
CMD ["pi"]
EOF

# 5. Pi config: models and default
cat > ~/pi-docker/agent/models.json << 'EOF'
{
  "providers": {
    "ollama": {
      "baseUrl": "http://host.docker.internal:11434/v1",
      "api": "openai-completions",
      "apiKey": "ollama",
      "models": [
        { "id": "inkling-2-mini:26b-a5b-nvfp4" },
        { "id": "qwen3.8:27b-mlx" }
      ]
    }
  }
}
EOF

cat > ~/pi-docker/agent/settings.json << 'EOF'
{
  "defaultProvider": "ollama",
  "defaultModel": "inkling-2-mini:26b-a5b-nvfp4"
}
EOF

# 6. Build the image
cd ~/pi-docker
docker build -t pi-sandbox .

# 7. pibox shortcut
cat >> ~/.zshrc << 'EOF'
alias pibox='docker run -it --rm -v "$PWD":/workspace -v ~/pi-docker/agent:/home/node/.pi/agent pi-sandbox'
EOF
source ~/.zshrc

# 8. Test the container can reach Ollama (prints "Ollama is running")
docker run --rm curlimages/curl -s http://host.docker.internal:11434

# 9. Optional: token-rate extension (after downloading token-rate.ts)
mkdir -p ~/pi-docker/agent/extensions
mv ~/Downloads/token-rate.ts ~/pi-docker/agent/extensions/

# 10. Use it
cd path/to/your/project
pibox
```

```bash
# Maintenance
pibox pi --model qwen3.8:27b-mlx                          # start with a specific model
ollama list                                               # installed models
ollama ps                                                 # loaded models
ollama rm <model>                                         # remove a model
cd ~/pi-docker && docker build --no-cache -t pi-sandbox . # upgrade Pi
docker image prune                                        # clean old images
# Inside Pi: /model  /reload  /tokrate   (Esc or Ctrl+C to stop)
```
