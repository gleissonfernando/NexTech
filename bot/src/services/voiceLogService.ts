import type { VoiceState } from "discord.js";
import type { BotContext } from "../types";
import { createSystemLog } from "./logService";

const joinedAt = new Map<string, number>();
export async function handleVoiceLogStateUpdate(oldState: VoiceState, newState: VoiceState, context: BotContext) {
  if (oldState.channelId === newState.channelId || newState.member?.user.bot) return;
  const key = `${newState.guild.id}:${newState.id}`; const now = Date.now();
  if (!oldState.channelId && newState.channelId) { joinedAt.set(key, now); await log(context,newState,"voice.join","User joined a voice channel",newState.channelId,null); return; }
  if (oldState.channelId && !newState.channelId) { const duration=Math.max(0,Math.floor((now-(joinedAt.get(key)??now))/1000));joinedAt.delete(key);await log(context,oldState,"voice.leave","User left a voice channel",oldState.channelId,duration);return; }
  if (oldState.channelId && newState.channelId) { const duration=Math.max(0,Math.floor((now-(joinedAt.get(key)??now))/1000));joinedAt.set(key,now);await createSystemLog(context,{guildId:newState.guild.id,userId:newState.id,module:"voice",action:"move",message:`${newState.member?.user.tag??newState.id} moved voice channels.`,metadata:{fromChannelId:oldState.channelId,toChannelId:newState.channelId,durationSeconds:duration}}); }
}
async function log(context:BotContext,state:VoiceState,type:string,message:string,channelId:string,durationSeconds:number|null){await createSystemLog(context,{guildId:state.guild.id,userId:state.id,module:"voice",action:type.split(".").at(1)??type,message:`${state.member?.user.tag??state.id}: ${message}.`,metadata:{channelId,durationSeconds}});}
