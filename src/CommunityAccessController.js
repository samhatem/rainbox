'use strict'
const io = require('orbit-db-io')
const entryIPFS = require('ipfs-log/src/entry')
const { getConfig } = require('./api')

const type = 'eth-contract/rain-community'
const MEMBER = 'MEMBER'
const MODERATOR = 'MODERATOR'
const ADMIN = 'ADMIN'

const OWNER_VAL = 3
const ADMIN_VAL = 2
const MODERATOR_VAL = 1

const isValidEthAddress = (web3, address) => {
  return web3.utils.isAddress(address)
}

class CommunityAccessController {
  constructor (ipfs, web3, abi, address) {
    this._ipfs = ipfs
    this.web3 = web3
    this.abi = abi
    this.contractAddress = address
  }

  static get type () { return type }

  get address () {
    return this.contractAddress
  }

  async load (address) {
    if (address) {
      try {
        if (address.indexOf('/ipfs') === 0) { address = address.split('/')[2] }
        const access = await io.read(this._ipfs, address)
        this.contractAddress = access.contractAddress
        this.abi = JSON.parse(access.abi)
      } catch (e) {
        throw new Error('CommunityAccessController.load ERROR:', e)
      }
    }
    this.contract = new this.web3.eth.Contract(this.abi, this.contractAddress)
  }

  async save () {
    let cid
    try {
      cid = await io.write(this._ipfs, 'dag-cbor', {
        contractAddress: this.address,
        abi: JSON.stringify(this.abi, null, 2)
      })
    } catch (e) {
      throw new Error('CommunityAccessController.save ERROR:', e)
    }

    return { address: cid }
  }

  async canAppend (entry, identityProvider) {
    const trueIfValidSig = async () => await identityProvider.verifyIdentity(entry.identity)

    const op = entry.payload.op
    const config = await getConfig(entry.identity.id)
    const address = this.getAddressFromConfig(config)

    if (!isValidEthAddress(this.web3, address)) {
      console.warn(`WARNING: "${address}" is not a valid eth address`)
      return Promise.resolve(false)
    }

    if (op === 'ADD') {
      const hasCapability = await this.contract.methods.canAppend(address).call()
      const hasValidSig = await trueIfValidSig()
      return hasCapability && hasValidSig
    }

    if (op === 'DEL') {
      const hash = entry.payload.value
      const delEntry = await entryIPFS.fromMultihash(this._ipfs, hash)

      // An id can delete their own entries
      if (delEntry.identity.id === entry.identity.id) return await trueIfValidSig()

      const delConfig = await getConfig(entry.identity.id)
      const delAddr = this.getAddressFromConfig(delConfig)
      const delCapability = this.getGreatestCapability(delAddr)
      if (delCapability === OWNER_VAL) return false

      const opCapability = this.getGreatestCapability(address)
      if (opCapability > delCapability) return await trueIfValidSig()
    }

    return false
  }

  // Move grant and revoke to community file?????????? Probably
  async grant (capability, identifier, options) {
    const config = await getConfig(identifier)
    const address = this.getAddressFromConfig(config)

    if (!isValidEthAddress(this.web3, address)) {
      console.warn(`WARNING: "${address}" is not a valid eth address`)
      return Promise.resolve(false)
    }
    switch (capability) {
      case MEMBER:
        return this.contract.methods.addMember(address).send(options)
      case MODERATOR:
        return this.contract.methods.addModerator(address).send(options)
      case ADMIN:
        return this.contract.methods.addAdmin(address).send(options)
      default:
        console.warn(`WARNING: "${capability}" is not a valid capability`)
        return Promise.resolve(false)
    }
  }

  async revoke (capability, identifier, options) {
    const config = await getConfig(identifier)
    const address = this.getAddressFromConfig(config)

    if (!isValidEthAddress(this.web3, address)) {
      console.warn(`WARNING: "${address}" is not a valid eth address`)
      return Promise.resolve(false)
    }
    switch (capability) {
      case MEMBER:
        return this.contract.methods.removeMember(address).send(options)
      case MODERATOR:
        return this.contract.methods.removeModerator(address).send(options)
      case ADMIN:
        return this.contract.methods.removeAdmin(address).send(options)
      default:
        console.warn(`WARNING: "${capability}" is not a valid capability`)
        return Promise.resolve(false)
    }
  }

  // MOVE THIS TO COMMUNITY.JS?
  async transferOwnership (identifier, options) {
    const config = await getConfig(identifier)
    const address = this.getAddressFromConfig(config)
    await this.contract.methods.transferOwnership(address).send(options)
  }

  static async create (orbitdb, options) {
    if (!options.web3) {
      throw new Error("No 'web3' given in options")
    }
    if (!options.abi && !options.address) {
      throw new Error("No 'abi' given in options")
    }
    if (!options.contractAddress) {
      throw new Error("No 'contractAddress' given in options")
    }

    return new CommunityAccessController(
      orbitdb._ipfs,
      options.web3,
      options.abi,
      options.contractAddress
    )
  }

  getAddressFromConfig (config) {
    const eoaLinks = config.links.filter(link => link.type === 'ethereum-eoa')
    const { address } = eoaLinks[0] // if and when people link multiple eth eoa's we'll need to specify their primary EOA
    return address
  }

  async getGreatestCapability (address) {
    const isOwner = await this.contract.methods.isOwner(address).call()
    if (isOwner) return OWNER_VAL

    const isAdmin = await this.contract.methods.isAdmin(address).call()
    if (isAdmin) return ADMIN_VAL

    const isMod = await this.contract.methods.isModerator(address).call()
    if (isMod) return MODERATOR_VAL

    return 0
  }
}

module.exports = CommunityAccessController
