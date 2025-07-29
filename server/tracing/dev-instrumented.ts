#!/usr/bin/env tsx
import dotenv from 'dotenv';

import { spawn, ChildProcess } from 'child_process'
import { buildWithInstrumentation } from './build-instrumented.js'
import * as fs from 'fs'

const SOURCE_DIR = '.'
const OUTPUT_DIR = 'dist/instrumented'
const ENTRY_FILE = 'dist/instrumented/src/index.js'

let serverProcess: ChildProcess | null = null
let rebuildTimeout: ReturnType<typeof setTimeout> | null = null


function startServer() {
    if (fs.existsSync(ENTRY_FILE)) {
        console.log('🚀 Starting instrumented server...')
        serverProcess = spawn('node', [ENTRY_FILE], {
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'development' }
        })

        serverProcess.on('error', (error) => {
            console.error('❌ Server error:', error)
        })

        serverProcess.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.log(`⚠️  Server exited with code ${code}`)
            }
        })
    } else {
        console.error('❌ Entry file not found:', ENTRY_FILE)
    }
}

function clearOutputDirectory() {
    if (fs.existsSync(OUTPUT_DIR)) {
        console.log('🧹 Clearing output directory...')
        fs.rmSync(OUTPUT_DIR, { recursive: true, force: true })
    }
}

function rebuild() {
    if (serverProcess) {
        console.log('🛑 Stopping server...')
        serverProcess.kill()
        serverProcess = null
    }

    clearOutputDirectory()

    if (rebuildTimeout) {
        clearTimeout(rebuildTimeout)
    }

    rebuildTimeout = setTimeout(() => {
        try {
            console.log('🔄 Rebuilding instrumented server...')
            dotenv.config();

            buildWithInstrumentation({
                sourceDir: SOURCE_DIR,
                outputDir: OUTPUT_DIR,
                enabled: true
            })

            startServer()
        } catch (error) {
            console.error('❌ Build failed:', error)
        }
    }, 100) // Keep debounce to prevent rapid rebuilds
}

// Initial build and start
rebuild()

// Watch for changes
console.log('👀 Watching for changes in', SOURCE_DIR)
const watcher = fs.watch(SOURCE_DIR, { recursive: true }, (eventType, filename) => {
    if (filename && (filename.endsWith('.ts') || filename.endsWith('.tsx') || filename.endsWith('.env'))) {
        console.log(`📝 File changed: ${filename}`)
        rebuild()
    }
})

// Cleanup on exit
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down...')
    watcher.close()
    if (serverProcess) {
        serverProcess.kill()
    }
    process.exit(0)
})

process.on('SIGTERM', () => {
    watcher.close()
    if (serverProcess) {
        serverProcess.kill()
    }
    process.exit(0)
}) 