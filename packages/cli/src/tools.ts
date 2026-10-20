#!/usr/bin/env node
import { parseProgram } from './lib/program.js'
import { createToolsProgram } from './tools-program.js'

void parseProgram(createToolsProgram())
