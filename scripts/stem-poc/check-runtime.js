// Foundational check: can onnxruntime-node load in this environment and
// what execution providers are available? This validates the whole
// "no-Python, ONNX in Node" approach before we invest in models + DSP.

import * as ort from 'onnxruntime-node';

console.log('node', process.version, process.platform, process.arch);
console.log('onnxruntime-node loaded OK');
console.log('available backends/EPs:', ort.listSupportedBackends?.() ?? '(listSupportedBackends not available)');

// Build a trivial in-memory ONNX model? Not needed — loading the addon and
// reading the version is enough to confirm the native binding works. If a
// model path is passed as argv[2], try to create a session from it.
const modelPath = process.argv[2];
if (modelPath) {
  console.log('attempting to load model:', modelPath);
  const t0 = Date.now();
  const session = await ort.InferenceSession.create(modelPath);
  console.log(`session created in ${Date.now() - t0}ms`);
  console.log('inputs:', session.inputNames);
  console.log('outputs:', session.outputNames);
  for (const name of session.inputNames) {
    const meta = session.inputMetadata?.[name];
    if (meta) console.log(`  input "${name}":`, JSON.stringify(meta));
  }
}
