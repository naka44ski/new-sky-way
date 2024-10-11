// main.js

const {
    nowInSec,
    SkyWayAuthToken,
    SkyWayContext,
    SkyWayRoom,
    SkyWayStreamFactory,
    uuidV4
} = skyway_room;

// SkyWayのキーを設定
const API_KEY = '696a988d-7c5b-471e-85fc-bca6b4e67868';
const SECRET_KEY = 'Dps44+cpl/6J4xhYlVl9UFHM2xbhiTrjKZ3L+YmLLFg=';

// Roomクラスの作成
class Room {
    constructor(opts, role) {
        this.api_key = API_KEY || '';
        this.room_id = opts.room_id || 'default_room';
        this.role = role; // 'operator' または 'user'

        this.token = null;
        this.context = null;
        this.room = null;
        this.me = null;
        this.conn = null;
        this.metadata = {
            role: this.role,
            name: opts.name || '匿名',
        };

        // ストリーム
        this.localVideo = null;
        this.localAudio = null;
        this.remoteVideo = null;
        this.remoteAudio = null;
    }

    async connectToSkyway() {
        if (this.api_key === '') {
            throw new Error('APIキーが設定されていません。');
        } else {
            try {
                this.secret_key = SECRET_KEY;
                this.token = new SkyWayAuthToken({
                    jti: uuidV4(),
                    iat: nowInSec(),
                    exp: nowInSec() + 60 * 60 * 24,
                    scope: {
                      app: {
                        id: API_KEY,
                        turn: true,
                        actions: ['read'],
                        channels: [
                                    {
                                        id: '*',
                                        name: '*',
                                        actions: ['write'],
                                        members: [{
                                            id: '*',
                                            name: '*',
                                            actions: ['write'],
                                            publication: {
                                              actions: ['write'],
                                            },
                                            subscription: {
                                              actions: ['write'],
                                            },
                                        },],
                                        sfuBots: [{
                                            actions: ['write'],
                                            forwardings: [
                                                {
                                                  actions: ['write'],
                                                },
                                            ],
                                        },],
                                    },
                                ],
                            },
                        },
                    }).encode(SECRET_KEY);
                    this.prepareForRoom(this.token, this.room, this.room_id, this.me, this.conn).then((result) => {
                        this.room = result.room;
                        this.me = result.me;
                        this.conn = result.conn;
                        this.me.updateMetadata((this.role == 'user') ? 'user' : 'operator').then(() => {
                            this.connectToSkywayRoom(this.room_id, undefined, this.room, this.me, this.conn).then(() => {
                            }).catch((error) => {
                                console.error('Skyway room connection error:', error);
                            });
                        });
                    });
                    
                    return true;
            } catch (error) {
                console.error('SkyWayへの接続エラー:', error);
            }
        }
    }

    async prepareForRoom(token, room, roomID, me, conn) {
        if (!this.context) {
            this.context = await SkyWayContext.Create(token);
        }

        room = await SkyWayRoom.FindOrCreate(this.context, {
            name: roomID,
            type: 'p2p',
        });

        me = await room.join();
        conn = await SkyWayStreamFactory.createDataStream();

        return { room, me, conn };
    }

    async leaveRoom() {
        if (this.me) {
            await this.room.leave(this.me);
        }
        if (this.room) {
            await this.room.close();
        }
    }

    async attachStream(id, video, audio) {
		const elm = document.getElementById(id);
		elm.autoplay = true;
		if (!!video) {
			video.attach(elm);
			console.log('attached stream', id, video);
		}
		if (!!audio) {
			audio.attach(elm);
			console.log('attached stream', id, audio);
		}

        await elm.play();
	}

    async connectToSkywayRoom(roomID, opts, room, me, localData) {
        try {
          if (!this.context || this.context == null) this.context = await SkyWayContext.Create(this.token);

          //もし既にpublishしてたらunpublishしておく
          if (!!room.publications) {
              for (let i = 0; i < room.publications.length; i++) {
                  if (room.publications[i].contentType != "data" && (room.publications[i].publisher.id == me.id || room.publications[i].metadata == me.metadata )) {
                      me.unpublish(room.publications[i].id);
                  }
              }
          }

          //自分のstreamを部屋に登録しておく
          await me.publish(localData);
          if (me.metadata == 'operator' || me.metadata == 'user') {
              //自分の映像の発行
              this.video = await SkyWayStreamFactory.createCameraVideoStream().then( async (stream) => {
                this.localVideoPublication = await me.publish(stream);
                return stream;
              }).catch( async () => {
              })

              //自分の音声の発行
              this.audio = await SkyWayStreamFactory.createMicrophoneAudioStream().then( async (stream) => {
                  this.localAudioPublication = await me.publish(stream);
                  return stream;
              }).catch( async () => {
              })

              this.attachStream("myVideo", this.video, this.audio);
          }
          //roomへ登録されたpublicationを受信したとき
          room.onStreamPublished.add((member) => {
              subscribeAndAttach(member.publication);
          });

          //room内に登録されたpublicationをattach（自分へ割り当て）する
          const subscribeAndAttach = async (publication) => {
              //publishした人のidが自分だったらSubscribeしないが
              if (!!me.id && publication.publisher.id === me.id) {
                  //publicationが誰のなのかmetadataに入れておく
                  if (!publication.metadata && !!me.metadata) publication.updateMetadata(me.metadata).then(() => {
                  });
                  
                  return;
              };
        
              //他人のpublicationを自分にSubscribeし、streamを取得
              const { stream } = await me.subscribe(publication.id);
              
              //取得したstreamの種別によって処理
              switch (stream.contentType) {

                  case 'video':
                      {   //初めて受け取ったstreamもしくは発行者が同じ場合は更新
                          if (this.role == 'user' && publication.metadata == 'operator') {
                              this.remoteVideo = stream;
                              this.attachStream('remoteVideo', this.remoteVideo);
                              this.remoteMember = 'operator';
                          } else if(this.role == 'operator' && publication.metadata == 'user') {
                              this.remoteVideo = stream;
                              this.attachStream('remoteVideo', this.remoteVideo);
                              this.remoteMember = 'user';
                          } else if (publication.metadata == this.remoteMember) {//話中の相手のstreamなら更新
                              this.remoteVideo = stream;
                              this.attachStream('remoteVideo',stream,undefined);
                              document.getElementById('remoteVideo').load();
                          }
                      }
                    break;
                  case 'audio':
                      {
                          if (this.role == 'user' && publication.metadata == 'operator') {
                              this.remoteAudio = stream;
                              this.attachStream('remoteVideo', undefined, this.remoteAudio);
                              this.remoteMember = 'operator';
                          } else if(this.role == 'operator' && publication.metadata == 'user') {
                              this.remoteAudio = stream;
                              this.attachStream('remoteVideo', undefined, this.remoteAudio);
                              this.remoteMember = 'user';
                          } else if (publication.metadata == this.remoteMember) { //話中の相手のstreamなら更新
                              this.remoteAudio = stream;
                              this.attachStream('remoteVideo', undefined, this.remoteAudio);
                              document.getElementById('remoteVideo').load();
                          }
                      }
                      break;
                  case 'data':
                      {
                          //受け取ったdataの内容から処理を判断
                          stream.onData.add((data) => {
                              console.log("get data:", data);
                              
                              if(data.cmd != undefined) {
                                  if (publication.metadata == 'user') {
                                      this.senderIsME = true;
                                  } else if (publication.metadata == 'operator') {
                                      this.senderIsOP = true;
                                  }
                                  this.connData(data);
                              }
                          
                                if(data.error != undefined) {
                                    errorHandler(1, data.type + ':' + data.message);
                                };
                                if(data.close != undefined) {
                                    this.connClose(data);
                                };

                                //有効期限切れる前に更新！
                                this.context.onTokenUpdateReminder.add(() => {
                                  if (sec < 500) {
                                      this.getCredential(roomID).then(async() => {
                                          token = new SkyWayAuthToken({
                                              jti: uuidV4(),
                                              iat: nowInSec(),
                                              exp: nowInSec() + 60 * 60 * 24,
                                              scope: {
                                                app: {
                                                  id: API_KEY,
                                                  turn: true,
                                                  actions: ['read'],
                                                  channels: [{
                                                                id: '*',
                                                                name: '*',
                                                                actions: ['write'],
                                                                members: [{
                                                                    id: '*',
                                                                    name: '*',
                                                                    actions: ['write'],
                                                                    publication: {
                                                                      actions: ['write'],
                                                                    },
                                                                    subscription: {
                                                                      actions: ['write'],
                                                                    },
                                                                },],
                                                                sfuBots: [{
                                                                    actions: ['write'],
                                                                    forwardings: [
                                                                        {
                                                                          actions: ['write'],
                                                                        },
                                                                    ],
                                                                },],
                                                              },
                                                          ],
                                                      },
                                                  },
                                              }).encode(this.secret_key);
                                          this.context.updateAuthToken(this.token);
                                          return true;
                                }).catch((err) => {
                                    errorHandler(1, err);
                                    //更新できなかったので、接続を切る
                                    room.leave(me);
                                    room.close();
                                    // exitAlert(jsMsg.peerAuthError, 104);
                                });
                              }})
                          });
                      }                                
                      break;
                  };

              };
              room.publications.forEach(subscribeAndAttach);
              return true;
          } catch (error) {
          throw error;
        }
    }
}

// ルームの初期化
let roomInstance;

// UI要素の取得
const loginScreen = document.getElementById('loginScreen');
const operatorScreen = document.getElementById('operatorScreen');
const userScreen = document.getElementById('userScreen');
const mainScreen = document.getElementById('main');

const operatorBtn = document.getElementById('operatorBtn');
const userBtn = document.getElementById('userBtn');

const endCallUser = document.getElementById('endCallUser');

// オペレーター選択時の処理
operatorBtn.addEventListener('click', () => {
    loginScreen.classList.remove('active');
    operatorScreen.classList.add('active');
    mainScreen.classList.add('active');
    roomInstance = new Room({},'operator');
    roomInstance.connectToSkyway().then(() => {

    }).catch((err) => {
        console.log("error",err);
    });

    // HTML内の<span id="myPeerId">を取得
    const peerIdElement = document.getElementById('myRoomId');
    // room_idが空でないかをチェックして表示を更新
    if (roomInstance.room_id && roomInstance.room_id !== "") {
        peerIdElement.textContent = roomInstance.room_id;  // room_idが空でない場合に表示
    } else {
        peerIdElement.textContent = "取得中...";  // room_idが空の場合に"取得中..."を表示
    }
});

// 利用者選択時の処理
userBtn.addEventListener('click', () => {
    loginScreen.classList.remove('active');
    userScreen.classList.add('active');
    mainScreen.classList.add('active');
    roomInstance = new Room({},'user');
    roomInstance.connectToSkyway().then(() => {

    }).catch((err) => {
        console.log("error",err);
    });
});

endCallUser.addEventListener('click', () => {
    roomInstance.leaveRoom();
    userScreen.classList.remove('active');
    mainScreen.classList.remove('active');
    operatorScreen.classList.remove('active');
    loginScreen.classList.add('active');
});