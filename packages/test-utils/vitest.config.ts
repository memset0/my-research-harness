import { defineConfig, mergeConfig } from 'vitest/config'
import { memonVitestPreset } from './src/vitest-preset'

export default mergeConfig(memonVitestPreset, defineConfig({}))
