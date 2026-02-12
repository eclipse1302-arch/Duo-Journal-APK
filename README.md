---
license: apache-2.0
title: 双人日记
sdk: docker
emoji: 🚀
colorFrom: blue
colorTo: indigo
pinned: false
---

# Duo-Journal

# Easy Startup

Run the app.py and you can visit the website with http://localhost:7860/ locally. 

Or, visit https://www.modelscope.cn/studios/eclipse1302/Duo-Journal/ for the latest version of the website remotely. 

# Ngrok Startup

First, sign in to ngrok, replace $YOUR_AUTHTOKEN$ with your authtoken and run the command, 
```js
ngrok config add-authtoken $YOUR_AUTHTOKEN
```

Then, change the directory of the start-server.bat and then execute it. 


```js
#start-server.bat
@echo off
title Duo Journal Server
echo ========================================
echo   Duo Journal - Starting Services...
echo ========================================
echo.

:: Start Vite dev server in background
echo [1/2] Starting Vite dev server on port 5173...
cd /d "e:\SJTU\Projects\Hackathon\Diary\duo-journal"
start "Vite Dev Server" cmd /c "npm run dev -- --port 5173 --host"

:: Wait for Vite to be ready
echo Waiting for Vite to start...
timeout /t 5 /nobreak >nul

:: Start ngrok
echo [2/2] Starting ngrok tunnel...
start "ngrok" cmd /c "ngrok http 5173"

echo.
echo ========================================
echo   Both services are running!
echo   Local:  http://localhost:5173
echo   ngrok:  Check the ngrok window for URL
echo ========================================
echo.
echo Press any key to STOP all services...
pause >nul

:: Cleanup - kill both processes
echo Shutting down...
taskkill /fi "windowtitle eq Vite Dev Server" /f >nul 2>&1
taskkill /fi "windowtitle eq ngrok" /f >nul 2>&1
taskkill /im ngrok.exe /f >nul 2>&1
echo Done.
```


# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
