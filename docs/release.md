# Creating a new release

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
