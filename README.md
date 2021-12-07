# Matter Obsidian Plugin

Sync all of your [Matter](https://hq.getmatter.app) highlights and notes directly to your Obsidian vault.

## Usage
1. Install the Matter plugin via the Obsidian community plugins page
2. Enable the plugin
3. In the "Matter" settings page, connect the plugin to your Matter account
4. Configure the integration
5. Sync!

After the initial setup, Matter will automatically sync in the background.


## Creating a new release

1. Update the following files with the new release version:
  - manifest.json
  - package.json
  - versions.json
2. Commit and push those changes.
3. Run:
  ```
  git tag -a <version> -m "<version>"
  git push origin <version>
  ```
