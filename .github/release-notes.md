> ⚠️ **Alpha, unaudited.** Use small amounts. Akoya will never ask for your recovery phrase.

### Install (Chrome / Brave / Edge)

1. Download `akoya-<version>.zip` below and **unzip** it.
2. Open `chrome://extensions`, turn on **Developer mode**.
3. Click **Load unpacked** and select the unzipped folder.

### Verify the download

```bash
shasum -a 256 akoya-<version>.zip   # must match akoya-<version>.zip.sha256
gh attestation verify akoya-<version>.zip -R akoya-wallet/akoya-extension
```

The attestation proves the zip was built by this repository's release workflow from the tagged commit.
