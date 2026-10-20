#!/usr/bin/env node
import { parseProgram } from './lib/program.js'
import { createResearchProgram } from './research-program.js'

void parseProgram(createResearchProgram())
