## ADDED Requirements

### Requirement: Wiki reading body declares its language

The wiki reading body SHALL carry a `lang` attribute matching the page's effective language: `en` for English pages and `zh-CN` for `language: zh` pages.

#### Scenario: Chinese page body
- **GIVEN** a page with `language: zh`
- **WHEN** it is rendered on the full-page or side-pane surface
- **THEN** its body element has `lang="zh-CN"`
