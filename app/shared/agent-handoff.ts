export function bootstrapPrompt(template:string,origin:string,credential:{secret:string;expires_at:string}){
 return template.replace('{{MCP_SERVER_URL}}',origin+'/mcp')
  .replace('{{AUTH_CONFIGURATION}}',JSON.stringify({mcpServers:{commie_talent_scout:{url:origin+'/mcp',headers:{Authorization:'Bearer '+credential.secret}}}},null,2))
  .replace('{{CREDENTIAL_EXPIRES}}',credential.expires_at)
  .replace('{{AUTHORIZATION_GUIDE}}',origin+'/account/connections');
}
