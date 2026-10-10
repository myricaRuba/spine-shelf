# Third-party notices

The MIT license at the repository root covers original Spine Shelf code and project materials only. Third-party components and demonstration assets retain the licenses below. Distribution of the complete application must comply with all applicable third-party terms.

## Spine Runtimes and examples

Spine Runtimes use the **Spine Runtimes License Agreement**, not MIT. The complete application must not be described as consisting solely of MIT-licensed components.

- [Spine Runtimes License Agreement](https://esotericsoftware.com/spine-runtimes-license)
- [Spine Editor License Agreement, Section 2](https://esotericsoftware.com/spine-editor-license)
- [Official source repository](https://github.com/EsotericSoftware/spine-runtimes)

Integration and modification of software containing Spine Runtimes are subject to the upstream license requirements. The runtime license also describes an alternative under which each user of a product must obtain their own Spine Editor license. This repository does not represent that users receive an exemption from those requirements. MIT permission for Spine Shelf does not grant rights to the Spine Editor or remove the runtime conditions. Include the upstream license and copyright notices when redistributing source or binaries.

| Component             | Source / version                                              | Included notice                                                                    |
| --------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Legacy WebGL runtime  | `spine-runtimes` 3.8 branch, `spine-ts/build/spine-webgl.js`  | [3.8 license](licenses/spine-3.8.txt), [source hash](licenses/spine38-source.json) |
| WebGL + core runtime  | `@esotericsoftware/spine-webgl` / `spine-core` 4.0.31         | [WebGL](licenses/spine-4.0.txt), [core](licenses/spine-core-4.0.txt)               |
| WebGL + core runtime  | 4.1.56                                                        | [WebGL](licenses/spine-4.1.txt), [core](licenses/spine-core-4.1.txt)               |
| WebGL + core runtime  | 4.2.120                                                       | [WebGL](licenses/spine-4.2.txt), [core](licenses/spine-core-4.2.txt)               |
| WebGL + core runtime  | 4.3.13                                                        | [WebGL](licenses/spine-4.3.txt), [core](licenses/spine-core-4.3.txt)               |
| Demonstration exports | 4.2 branch, `examples/{spineboy,raptor,alien,goblins}/export` | [Original example notice](resources/examples/LICENSE)                              |

`public/vendor/spine38.js` includes its upstream license notice. Spine Shelf applies one local compatibility change: the JSON reader accepts version `3.8.75` through the existing 3.8 parser and structural checks, preserving the source version metadata. The binary reader's version guard is unchanged. The original, unmodified source hash and URL are recorded in `licenses/spine38-source.json`; regression coverage is in `tests/spine38-runtime.test.cjs`. The npm runtimes are referenced as aliases `spine40` through `spine43`.

Demonstration characters, textures, skeletons, and atlas data belong to Esoteric Software and are not original Spine Shelf artwork. Their presence here does not authorize extracting or relicensing them under MIT. The product screenshot uses these same official demonstrations, not a user's imported library.

## Other bundled components

| Component    | Version in package-lock.json | License / notice                                                                                             |
| ------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| React        | 19.3.0                       | [MIT](licenses/react.txt)                                                                                    |
| React DOM    | 19.3.0                       | [MIT](licenses/react-dom.txt)                                                                                |
| Scheduler    | 0.28.0                       | [MIT](licenses/scheduler.txt)                                                                                |
| Lucide React | 0.468.0                      | [ISC and component notices](licenses/lucide-react.txt)                                                       |
| Electron     | 44.7.0                       | [MIT](licenses/electron.txt); Electron/Chromium third-party notices also accompany the Electron distribution |
| MCP SDK      | 1.32.1                       | [MIT](licenses/mcp-sdk.txt) |
| Zod          | 4.6.5                        | [MIT](licenses/zod.txt) |
| pngjs        | 7.0.0                        | [MIT](licenses/pngjs.txt) |
| smol-toml    | 1.9.1                        | [BSD-3-Clause](licenses/smol-toml.txt) |

Exact dependency versions and integrity hashes are locked in `package-lock.json`. Development-only tools retain the licenses in their respective packages.

## Brand artwork

The original Spine Shelf icon was generated with the built-in imagegen tool and packaged by this project. The master and generation prompt are in `resources/brand/`. It is an independent mark and is not an official Spine or Esoteric Software logo.

## Distribution layout

The desktop package includes `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses/`, and the examples' original `LICENSE` in its resources directory. On macOS these are under `Spine Shelf.app/Contents/Resources/`. On Windows they are under `<installation directory>/resources/`. Keep these materials with redistributed builds.
