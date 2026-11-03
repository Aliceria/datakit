import { parentPort } from 'node:worker_threads';
import { runParse, type ParseRequest } from './parseJob.ts';

// Cada worker atende um único pedido e termina: a memória do parsing é devolvida inteira.
// A resposta é copiada, não transferida: os Buffers do zlib podem vir do pool interno do Node,
// que não pode ser transferido entre threads (e os dados já estão compactados, então são pequenos).
parentPort?.once('message', (request: ParseRequest) => {
  void runParse(request).then((response) => {
    parentPort?.postMessage(response);
  });
});
