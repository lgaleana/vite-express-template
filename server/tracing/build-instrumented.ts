#!/usr/bin/env tsx
import * as ts from 'typescript'
import * as fs from 'fs'
import * as path from 'path'
import { instrumentSourceCode } from './ts-morph-function-tracer.js'

interface BuildOptions {
    sourceDir: string
    outputDir: string
}

export function buildWithInstrumentation(options: BuildOptions) {
    const { sourceDir, outputDir } = options

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
    const tsFiles = getTypeScriptFiles(sourceDir)
    
    // Process each file with ts-morph instrumentation
    for (const filePath of tsFiles) {
        try {
            // Read source code
            const sourceCode = fs.readFileSync(filePath, 'utf-8')
            
            // Instrument with ts-morph tracer
            const instrumentedCode = instrumentSourceCode(filePath, sourceCode)
            
            // Write instrumented TypeScript file to temp location
            const relativePath = path.relative(sourceDir, filePath)
            const tempPath = path.join(outputDir, 'temp', relativePath)
            const tempDir = path.dirname(tempPath)
            
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true })
            }
            
            // Add .js extension imports for ESM compatibility
            const esmCode = addJsExtensions(instrumentedCode)
            fs.writeFileSync(tempPath, esmCode)
            
        } catch (error) {
            console.error(`❌ Failed to instrument ${filePath}:`, error)
            throw error
        }
    }

    // Compile instrumented TypeScript files to JavaScript
    const tempSourceDir = path.join(outputDir, 'temp')
    const instrumentedTsFiles = getTypeScriptFiles(tempSourceDir)
    
    const program = ts.createProgram({
        rootNames: instrumentedTsFiles,
        options: {
            ...buildOptions,
            rootDir: tempSourceDir,
        }
    })

    // Emit JavaScript files
    const emitResult = program.emit()

    // Clean up temp directory
    fs.rmSync(tempSourceDir, { recursive: true, force: true })

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

// Simple function to add .js extensions to imports for ESM compatibility
function addJsExtensions(code: string): string {
    // Replace relative imports without extensions with .js extensions
    return code.replace(
        /from\s+['"](\.\S*?)(?<!\.js)['"];/g,
        "from '$1.js';"
    ).replace(
        /import\s+['"](\.\S*?)(?<!\.js)['"];/g,
        "import '$1.js';"
    )
}