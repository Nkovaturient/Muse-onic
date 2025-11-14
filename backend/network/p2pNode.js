import { createLibp2p } from 'libp2p'
import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@libp2p/yamux'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { gossipsub } from '@chainsafe/libp2p-gossipsub'

export async function createPeer() {
  const node = await createLibp2p({
    transports: [webSockets(), webRTC()],
    connectionEncryption: [noise()],
    streamMuxers: [yamux()],
    pubsub: gossipsub(),
  })

  await node.start()
  console.log('Libp2p node started with id', node.peerId.toString())

  return node
}
