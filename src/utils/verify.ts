import { getEnvConf } from '../global-object/envconfig';
export function isAlias(key: string) {
  const envConf = getEnvConf();
  // Object.keys(envConf[0]!.alias).map((conf) => {
  //   const aliasKey = Object.keys(envConf[conf]).find((k) => k === key);
  //   if(aliasKey){
  //       return conf[aliasKey]
  //   }
  //   return 
  // });
}
