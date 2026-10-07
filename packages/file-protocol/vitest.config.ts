import { defineConfig, mergeConfig } from 'vitest/config'
import { memonVitestPreset } from '../test-utils/src/vitest-preset'

export default mergeConfig(memonVitestPreset, defineConfig({}))
