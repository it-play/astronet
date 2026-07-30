import { compileContent, formatCompilerError } from './content/compiler';

try {
  const result = await compileContent(process.cwd());
  const { counts, buildId } = result.manifest;
  process.stdout.write(
    `Content ${buildId}: ${counts.documents} documents, ${counts.boards} boards, ${counts.strongEdges} strong edges, ${counts.weakEdges} weak edges\n`,
  );
} catch (error) {
  process.stderr.write(`${formatCompilerError(error)}\n`);
  process.exitCode = 1;
}
