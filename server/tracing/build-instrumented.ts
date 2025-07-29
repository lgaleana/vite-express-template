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
}

export function buildWithInstrumentation(options: BuildOptions) {
    const { sourceDir, outputDir, enabled = true } = options

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
        module: ts.ModuleKind.NodeNext,
        target: ts.ScriptTarget.ES2022,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
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