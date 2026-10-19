export function integrate(source){
 const from='    const agents = buildWebexAgentRows(agentsResult, now, centralDayStart);';
 if(source.split(from).length!==3||source.includes('VB_CHAT_PROFILE_CAPACITY_V1'))throw Error('Unexpected capacity integration baseline');
 return source.replaceAll(from,'    const agents = await vbEnrichChatCapacity(buildWebexAgentRows(agentsResult, now, centralDayStart), env, webexFetch, (await getWebexRegionState(env)).baseUrl);')+'\n// VB_CHAT_PROFILE_CAPACITY_V1\nimport {enrichChatCapacity as vbEnrichChatCapacity} from "./worker-patches/chat-profile-capacity.mjs";\n';
}
