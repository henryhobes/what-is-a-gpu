# What is a GPU?

An interactive explainer for people outside hardware. It makes two points that "thousands of cores" misses:

1. A GPU is fast only when the work is a lot of the same independent operation. When the work is mixed, most of its lanes sit idle and a CPU catches up.
2. The usual limit is memory bandwidth, not arithmetic. On an NVIDIA H100 the crossover (the roofline's ridge point) is about 295 operations per byte. On an AMD EPYC 9654 it is about 23.7.

It is plain HTML, CSS, and ES modules: no build step, no dependencies, and no network requests beyond its own files.

## Files

| File | What it holds |
| --- | --- |
| `index.html` | The page. All prose and every number, so it reads correctly with JavaScript off. |
| `style.css` | All styling, light and dark. |
| `data.js` | The two machines' specs, the stated modeling assumptions, and every number derived from them. |
| `roofline.js` | `ridge(machine)` and `achievable(machine, intensity)`. Pure arithmetic. |
| `beats.js` | One function per interactive beat. Each one owns its own state and drawing. |
| `test/roofline.test.mjs` | Checks the ridge points against the spec values, and checks that every number in `index.html` matches `data.js`. |

The numbers in `index.html` are written out as `<span data-fact="h100.ridge">295</span>`. If you change a spec in `data.js`, `npm test` will list each sentence that is now out of date.

## Run it locally

Browsers refuse to load ES modules from a `file://` URL, so serve the folder rather than double-clicking `index.html`. Opened as a file, the page still shows all its prose and numbers; only the interactive parts are replaced by a short note.

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Run the tests (Node 24+):

```sh
npm test
```

## How GitHub Pages serves it

Under Settings → Pages, set the source to "Deploy from a branch", branch `main`, folder `/ (root)`. Pages serves the files exactly as they are in the repo. There is nothing to build.
