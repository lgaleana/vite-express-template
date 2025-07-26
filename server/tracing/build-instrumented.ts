#!/usr/bin/env tsx
import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import { createFunctionTracerTransformer } from './function-tracer-transformer.js'
import { createImportExtensionTransformer } from './import-extension-transformer.js'

interface BuildOptions {
    sourceDir: string
    outputDir: string
    enabled?: boolean
    watch?: boolean
}

export function buildWithInstrumentation(options: BuildOptions) {
    const { sourceDir, outputDir, enabled = true, watch = false } = options

    // Read tsconfig.json
    const configPath = ts.findConfigFile('./', ts.sys.fileExists, 'tsconfig.json')
    if (!configPath) {
        throw new Error('Could not find tsconfig.json')
    }

    const configFile = ts.readConfigFile(configPath, ts.sys.readFile)
    const compilerOptions = ts.parseJsonConfigFileContent(
        configFile.config,
        ts.sys,
        './',
    ).options

    // Override options for our build
    const buildOptions: ts.CompilerOptions = {
        ...compilerOptions,
        outDir: outputDir,
        rootDir: sourceDir,
        module: ts.ModuleKind.ES2022,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.Node16,
        allowImportingTsExtensions: false,
        noEmit: false,
        declaration: false,
        sourceMap: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
    }

    // Get all TypeScript files
    const program = ts.createProgram({
        rootNames: getTypeScriptFiles(sourceDir),
        options: buildOptions,
    })

    // Create transformers
    const functionTracer = createFunctionTracerTransformer({ enabled })
    const importExtension = createImportExtensionTransformer()

    // Emit with transformers
    const emitResult = program.emit(undefined, undefined, undefined, false, {
        before: [functionTracer, importExtension],
    })

    // Report diagnostics
    const allDiagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics)

    allDiagnostics.forEach(diagnostic => {
        if (diagnostic.file) {
            const { line, character } = ts.getLineAndCharacterOfPosition(
                diagnostic.file,
                diagnostic.start!
            )
            const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
            console.log(`${diagnostic.file.fileName} (${line + 1},${character + 1}): ${message}`)
        } else {
            console.log(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
        }
    })

    if (watch) {
        console.log('👀 Watching for changes...')
        // Simple file watcher
        watchDirectory(sourceDir, () => {
            console.log('🔄 Rebuilding...')
            buildWithInstrumentation({ ...options, watch: false })
        })
    }

    // Ensure output directory exists and create package.json for ES modules
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true })
    }

    const packageJsonContent = {
        "type": "module"
    }

    const packageJsonPath = path.join(outputDir, 'package.json')
    fs.writeFileSync(packageJsonPath, JSON.stringify(packageJsonContent, null, 2))

    console.log(`✅ Build complete! Output: ${outputDir}`)
    return emitResult.emitSkipped ? 1 : 0
}

function getTypeScriptFiles(dir: string): string[] {
    const files: string[] = []

    function traverse(currentDir: string) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true })

        for (const entry of entries) {
            const fullPath = path.join(currentDir, entry.name)

            if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
                traverse(fullPath)
            } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
                files.push(fullPath)
            }
        }
    }

    traverse(dir)
    return files
}

function watchDirectory(dir: string, callback: () => void) {
    const watcher = fs.watch(dir, { recursive: true }, (eventType, filename) => {
        if (filename && (filename.endsWith('.ts') || filename.endsWith('.tsx'))) {
            callback()
        }
    })

    process.on('SIGINT', () => {
        watcher.close()
        process.exit(0)
    })
}

// CLI usage
if (import.meta.url === `file://${process.argv[1]}`) {
    const args = process.argv.slice(2)
    const watch = args.includes('--watch')
    const sourceDir = args.find(arg => arg.startsWith('--source='))?.split('=')[1] || 'server'
    const outputDir = args.find(arg => arg.startsWith('--output='))?.split('=')[1] || 'dist/instrumented'

    buildWithInstrumentation({
        sourceDir,
        outputDir,
        enabled: true,
        watch
    })
} 