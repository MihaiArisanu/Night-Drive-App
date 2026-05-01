### How to Run the App
To set up and run this app, execute the appropriate script from the **root folder** of the project:

*   **For Android:**
    ```bash
    ./start-dev-android.sh
    ```
*   **For iOS:**
    ```bash
    ./start-dev-ios.sh
    ```

**Note:** These scripts will automatically start the Docker containers, the Metro bundler, and launch the app on your emulator or physical device.

### Troubleshooting

If you encounter problems getting the app to run via the scripts, try the following solutions in order:

#### A. Grant Execution Permissions
If you receive a "Permission denied" error, the scripts likely lost their execution rights during download. Run these commands in the root folder to fix it:
```bash
chmod +x start-dev-android.sh
chmod +x start-dev-ios.sh