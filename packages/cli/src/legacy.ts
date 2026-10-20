#!/usr/bin/env node
import { createLegacyProgram } from './legacy-program.js'
import { parseProgram } from './lib/program.js'

void parseProgram(createLegacyProgram())
