const isIPFS = require('is-ipfs')
const API = require('./api')
const config = require('./config')
const orbitAddress = require('orbit-db/src/orbit-db-address')

const ORBITDB_OPTS = config.orbitdb_options

const isValid3ID = did => {
  const parts = did.split(':')
  if (!parts[0] === 'did' || !parts[1] === '3') return false
  return isIPFS.cid(parts[2])
}

class Community {
  // thread but confidential default false and members true
  constructor (name, replicator, contractAddress, abi, web3) {
    this._name = name
    this._replicator = replicator
    this._contractAddress = contractAddress
    this._abi = abi
    this._web3 = web3
  }

  /**
   * Post a message to the thread
   *
   * @param     {Object}    message                 The message
   * @return    {String}                            The postId of the new post
   */
  async post (message) {
    this._requireLoad()
    this._subscribe(this._address, { firstModerator: this._firstModerator, members: this._members, name: this._name })
    this._replicator.ensureConnected(this._address, true)
    const timestamp = Math.floor(new Date().getTime() / 1000) // seconds

    if (this._confidential) message = this._symEncrypt(message)

    return this._db.add({
      message,
      timestamp
    })
  }

  /**
   * Add a moderator to this thread, throws error is user can not add a moderator
   *
   * @param     {String}    id                      Moderator Id
   */
  async addModerator (id) {
    this._requireLoad()

    if (id.startsWith('0x')) {
      id = await API.getSpaceDID(id, this._spaceName)
    }

    if (!isValid3ID(id)) throw new Error('addModerator: must provide valid 3ID')

    return this._db.access.grant(MODERATOR, id, await this._encryptSymKey(id))
  }

  /**
   * Add a member to this thread, throws if user can not add member, throw is not member thread
   *
   * @param     {String}    id                      Member Id
   */
  async addMember (id) {
    this._requireLoad()
    this._throwIfNotMembers()
    if (id.startsWith('0x')) {
      id = await API.getSpaceDID(id, this._spaceName)
    }
    if (!isValid3ID(id)) throw new Error('addMember: must provide valid 3ID')

    return this._db.access.grant(MEMBER, id, await this._encryptSymKey(id))
  }

  /**
   * Delete post
   *
   * @param     {String}    id                      Moderator Id
   */
  async deletePost (hash) {
    this._requireLoad()
    return this._db.remove(hash)
  }

  /**
   * Returns an array of posts, based on the options.
   * If hash not found when passing gt, gte, lt, or lte,
   * the iterator will return all items (respecting limit and reverse).
   *
   * @param     {Object}    opts                    Optional parameters
   * @param     {String}    opts.gt                 Greater than, takes an postId
   * @param     {String}    opts.gte                Greater than or equal to, takes an postId
   * @param     {String}    opts.lt                 Less than, takes an postId
   * @param     {String}    opts.lte                Less than or equal to, takes an postId
   * @param     {Integer}   opts.limit              Limiting the number of entries in result, defaults to -1 (no limit)
   * @param     {Boolean}   opts.reverse            If set to true will result in reversing the result
   *
   * @return    {Array<Object>}                           true if successful
   */
  async getPosts (opts = {}) {
    this._requireLoad()
    if (!opts.limit) opts.limit = -1
    return this._db.iterator(opts).collect().map(entry => {
      const post = entry.payload.value
      const metaData = { postId: entry.hash, author: entry.identity.id }
      return Object.assign(metaData, post)
    })
  }

  async onUpdate (updateFn) {
    this._requireLoad()
    this._db.events.on('replicated', (address, hash, entry, prog, tot) => {
      updateFn()
    })
    this._db.events.on('write', (dbname, entry) => {
      updateFn()
    })
  }

  async _load (dbString) {
    const loadByAddress = dbString && orbitAddress.isValid(dbString)
    if (!loadByAddress) await this._initAcConfigs()

    if (!this._accessController) _initAcConfigs()
    this._db = await this._replicator._orbitdb.feed(this._name, {
      ...ORBITDB_OPTS,
      accessController: this._accessController
    })

    if (loadByAddress) {
      // set variablies if loaded by address
    }

    await this._db.load()
  }

  _requireLoad () {
    if (!this._db) throw new Error('_load must be called before interacting with the store')
  }

  async close () {
    this._requireLoad()
    await this._db.close()
  }

  async _initAcConfigs () {
    if (this._accessController) return
    this._accessController = {
      type: 'eth-contract/rain-community',
      web3: this._web3,
      abi: this._abi,
      contractAddress: this._contractAddress
    }

    if (this._encKeyId) {
      this._accessController.encKeyId = this._encKeyId
    }
  }
}

module.exports = Community
