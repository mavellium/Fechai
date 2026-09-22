export type VariableDefinition = { key: string; description: string };
export type ConversationVariables = Record<string, string>;

export const DEFAULT_VARIABLES: VariableDefinition[] = [
  { key: "nome", description: "Nome da pessoa que está conversando;" },
  { key: "numero", description: "Número de telefone do contato desta conversa." },
  { key: "endereco", description: "Endereço informado pelo contato durante esta conversa." },
];
export const MAX_CUSTOM_VARIABLES = 20;

export function allVariableDefinitions(custom: VariableDefinition[]): VariableDefinition[] {
  return [...DEFAULT_VARIABLES, ...custom];
}
