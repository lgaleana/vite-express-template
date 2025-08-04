#!/usr/bin/env tsx
import dotenv from 'dotenv';
import { spawn, ChildProcess } from 'child_process';
import { buildWithBabel } from './build-with-babel.ts';
import * as fs from 'fs';
import * as path from 'path';
import chokidar from 'chokidar';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const serverRoot = path.dirname(__dirname); // Go up one level from tracing/ to server/
const SOURCE_DIR = serverRoot; // Watch server root
const OUTPUT_DIR = path.join(serverRoot, 'dist/instrumented');
const ENTRY_FILE = path.join(serverRoot, 'dist/instrumented/index.js');

let serverProcess: ChildProcess | null = null;
let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;

function startServer(): void {
    if (fs.existsSync(ENTRY_FILE)) {
        console.log('🚀 Starting instrumented server...');
        serverProcess = spawn('node', [ENTRY_FILE], {
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'development' }
        });

        serverProcess.on('error', (error) => {
            console.error('❌ Server error:', error);
        });

        serverProcess.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.log(`⚠️  Server exited with code ${code}`);
            }
        });
    } else {
        console.error('❌ Entry file not found:', ENTRY_FILE);
    }
}

function clearOutputDirectory(): void {
    if (fs.existsSync(OUTPUT_DIR)) {
        console.log('🧹 Clearing output directory...');
        fs.rmSync(OUTPUT_DIR, { recursive: true, force: true });
    }
}

function rebuild(): void {
    if (serverProcess) {
        console.log('🛑 Stopping server...');
        serverProcess.kill();
        serverProcess = null;
    }

    clearOutputDirectory();

    try {
        console.log('🔄 Rebuilding with Babel...');
        dotenv.config();

        buildWithBabel();
    } catch (error) {
        console.error('❌ Build failed:', error);
        return;
    }

    startServer();
}

// Initial build and start
rebuild();

// Watch for changes
console.log('👀 Watching for changes in', SOURCE_DIR);
const watcher = chokidar.watch(SOURCE_DIR, {
    ignored: [
        /(^|[\\/])node_modules([\\/]|$)/,   // any "node_modules" segment
        /(^|[\\/])dist([\\/]|$)/,
        /(^|[\\/])\.git([\\/]|$)/,
        /(^|[\\/])tracing([\\/]|$)/         // ← root‑level or nested "tracing/"
    ],
    ignoreInitial: true,
    awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50
    }
});

watcher.on('all', (event, path) => {
    if (path && (path.endsWith('.ts') || path.endsWith('.tsx') || path.endsWith('.env'))) {
        console.log(`📝 File ${event}: ${path}`);

        // Debounce rebuilds
        if (rebuildTimeout) {
            clearTimeout(rebuildTimeout);
        }
        rebuildTimeout = setTimeout(rebuild, 150);
    }
});

watcher.on('error', (error) => {
    console.error('👀 Watcher error:', error);
});

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...');
    watcher.close();
    if (serverProcess) {
        serverProcess.kill();
    }
    process.exit(0);
});

process.on('SIGTERM', () => {
    watcher.close();
    if (serverProcess) {
        serverProcess.kill();
    }
    process.exit(0);
}); 