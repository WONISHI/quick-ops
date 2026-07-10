export interface ETIPlugin {
  pluginId: string;
  on?: ETIEvent[];
}


export interface ETIEvent {
  name: string;
  callback: (...args:any[])=>any;
}



export interface ETICore {
  coreId:string;
  provide():ETICoreProvide;
  inject?(events:Record<string,Function[]>):void;
}



export interface ETICoreProvide {
  coreId:string;
  register:ETIEvent[];
}