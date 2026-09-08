import bootstrapPrompt from "../../../app/shared/bootstrap-prompt.txt?raw";

// The prototype fills environment facts only; business guidance belongs to MCP.
export const protocolText = bootstrapPrompt
  .replace("{{MCP_SERVER_URL}}", "尚未提供（当前为前端原型）")
  .replace("{{AUTHORIZATION_GUIDE}}", "尚未提供；当前原型不能实际接入 MCP");
