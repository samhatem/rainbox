'use strict'
const io = require('orbit-db-io')
const entryIPFS = require('ipfs-log/src/entry')
const ethers = require('ethers')
const { getConfig } = require('./api')

const type = 'eth-contract/rain-community'
const MEMBER = 'MEMBER'
const MODERATOR = 'MODERATOR'
const ADMIN = 'ADMIN'

const OWNER_VAL = 3
const ADMIN_VAL = 2
const MODERATOR_VAL = 1

const isValidEthAddress = (address) => {
  try {
    ethers.utils.getAddress(address)
    return true
  } catch (e) {
    return false
  }
}

class CommunityAccessController {
  constructor (ipfs, web3, abi, address) {
    this._ipfs = ipfs
    this.provider = new ethers.providers.Web3Provider(web3)
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
    // PUT THIS CONTRACT LOGIC IN RAIN SERVICE?
    this.contract = new ethers.Contract(this.contractAddress, this.abi, this.provider)
    // connecting to signer may cause issues when creating without a connected wallet
    // TODO pass in whether community is read only to constructor
    this.contract = this.contract.connect(this.provider.getSigner())
  }

  async save () {
    let cid
    try {
      cid = await io.write(this._ipfs, 'dag-cbor', {
        contractAddress: this.contractAddress,
        abi: JSON.stringify(this.abi)
      })
    } catch (e) {
      throw new Error('CommunityAccessController.save ERROR:', e)
    }

    return cid
  }

  async canAppend (entry, identityProvider) {
    const trueIfValidSig = async () => await identityProvider.verifyIdentity(entry.identity)

    const op = entry.payload.op
    const config = await getConfig(entry.identity.id)
    const address = this.getAddressFromConfig(config)

    if (!isValidEthAddress(address)) {
      console.warn(`WARNING: "${address}" is not a valid eth address`)
      return Promise.resolve(false)
    }

    if (op === 'ADD') {
      const hasCapability = await this.contract.canAppend(address)
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

  async grant (capability, identifier, options) {
    const config = await getConfig(identifier)
    const address = this.getAddressFromConfig(config)

    if (!isValidEthAddress(address)) {
      console.warn(`WARNING: "${address}" is not a valid eth address`)
      return Promise.resolve(false)
    }

    console.warn(options, 'THE OPTIONS IN GRANT, ARE THEY NECESSARY?')

    // NOT SURE IF .SEND(OPTIONS) IS NECESSARY AND MIGHT EVEN CAUSE ERRORS
    // HAVE NOT TESTED
    switch (capability) {
      case MEMBER:
        return this.contract.addMember(address).send(options)
      case MODERATOR:
        return this.contract.addModerator(address).send(options)
      case ADMIN:
        return this.contract.addAdmin(address).send(options)
      default:
        console.warn(`WARNING: "${capability}" is not a valid capability`)
        return Promise.resolve(false)
    }
  }

  async revoke (capability, identifier, options) {
    const config = await getConfig(identifier)
    const address = this.getAddressFromConfig(config)

    if (!isValidEthAddress(address)) {
      console.warn(`WARNING: "${address}" is not a valid eth address`)
      return Promise.resolve(false)
    }

    console.warn(options, 'THE OPTIONS IN REVOKE, ARE THEY NECESSARY?')

    // NOT SURE IF .SEND(OPTIONS) IS NECESSARY AND MIGHT EVEN CAUSE ERRORS
    // HAVE NOT TESTED
    switch (capability) {
      case MEMBER:
        return this.contract.removeMember(address).send(options)
      case MODERATOR:
        return this.contract.removeModerator(address).send(options)
      case ADMIN:
        return this.contract.removeAdmin(address).send(options)
      default:
        console.warn(`WARNING: "${capability}" is not a valid capability`)
        return Promise.resolve(false)
    }
  }

  // MOVE THIS TO COMMUNITY.JS?
  async transferOwnership (identifier, options) {
    const config = await getConfig(identifier)
    const address = this.getAddressFromConfig(config)
    await this.contract.transferOwnership(address).send(options)
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
    const isOwner = await this.contract.isOwner(address)
    if (isOwner) return OWNER_VAL

    const isAdmin = await this.contract.isAdmin(address)
    if (isAdmin) return ADMIN_VAL

    const isMod = await this.contract.isModerator(address)
    if (isMod) return MODERATOR_VAL

    return 0
  }
}

module.exports = CommunityAccessController
