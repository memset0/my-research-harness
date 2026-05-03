// Shared YAML engine config for gray-matter.
//
// JSON_SCHEMA is used to disable date auto-detection — ISO8601 strings stay as
// strings rather than being coerced to Date (which loses timezone offset and
// breaks our convention of preserving the writer's local offset verbatim).

import yaml from 'js-yaml'

export const yamlEngine = {
  parse: (str: string) => yaml.load(str, { schema: yaml.JSON_SCHEMA }) as object,
  stringify: (obj: object) => yaml.dump(obj, { schema: yaml.JSON_SCHEMA }),
}

export const matterOptions = {
  engines: { yaml: yamlEngine },
}
