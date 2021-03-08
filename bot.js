import Settings from "./src/settings"
import DiscordInit from "./src/boot"

if(process.env.TOKEN && process.env.TOKEN.length > 0){

DiscordInit(process.env.TOKEN);

}else{
  console.log("[Error] No discord bot secret token set. Please, provide one. Aborting.");
}