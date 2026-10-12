import type { CodegenConfig } from '@graphql-codegen/cli';

// Types for every GraphQL operation the forges make, generated from the
// vendors' live schemas, so a run needs the network.
const forge = (name: string, schema: string) => ({
  schema,
  documents: `src/lib/server/forges/${name}.gql.ts`,
  preset: 'client' as const,
  presetConfig: {
    gqlTagName: 'graphql',
    // Server-side code reads fragments directly; the masking helpers would be
    // one indirection for nothing.
    fragmentMasking: false,
  },
  config: {
    // The forges send the query as a string (octokit's and the hand-rolled
    // POST both take one), so the documents generate as typed strings rather
    // than AST objects.
    documentMode: 'string',
    // Union string literals, not TS enums: the forge code compares against
    // string literals and feeds states into `string | null` fields.
    enumsAsTypes: true,
    useTypeImports: true,
    scalars: {
      DateTime: 'string',
      URI: 'string',
      GitObjectID: 'string',
      HTML: 'string',
    },
  },
});

const config: CodegenConfig = {
  generates: {
    'src/lib/server/forges/gqlgen/github/': forge(
      'github',
      'https://raw.githubusercontent.com/octokit/graphql-schema/master/schema.graphql'
    ),
  },
};

export default config;
