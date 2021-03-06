const isIPFS = require('is-ipfs')
const API = require('./api')
const config = require('./config')
const OrbitDB = require('orbit-db')

const ORBITDB_OPTS = config.orbitdb_options
const MEMBER = 'MEMBER'
const MODERATOR = 'MODERATOR'
const ADMIN = 'ADMIN'

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
    this._web3 = web3
    this._abi = abi
  }

  /**
   * Post a message to the thread
   *
   * @param     {Object}    message                 The message
   * @return    {String}                            The postId of the new post
   */
  async post (message) {
    this._requireLoad()
    this._requireAuth()
    this._replicator.ensureConnected(this._feedAddress, true)
    const timestamp = Math.floor(new Date().getTime() / 1000) // seconds

    return this._db.add({
      message,
      timestamp
    })
  }

  get feedAddress () {
    return this._db ? this._feedAddress : null
  }

  get contractAddress () {
    return this._contractAddress
  }

  /**
   * Add a moderator to this thread, throws error is user can not add a moderator
   *
   * @param     {String}    id                      Moderator Id
   */
  async addModerator (id) {
    this._requireLoad()
    this._requireAuth()

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
    this._requireAuth()

    if (id.startsWith('0x')) {
      id = await API.getSpaceDID(id, this._spaceName)
    }
    if (!isValid3ID(id)) throw new Error('addModerator: must provide valid 3ID')

    return this._db.access.grant(MEMBER, id)
  }

  async addAdmin (id) {
    this._requireLoad()
    this._requireAuth()

    if (id.startsWith('0x')) {
      id = await API.getSpaceDID(id, this._spaceName)
    }
    if (!isValid3ID(id)) throw new Error('addAdmin: must provide valid 3ID')

    return this._db.access.grant(ADMIN, id)
  }

  /**
   * Delete post
   *
   * @param     {String}    id                      Moderator Id
   */
  async deletePost (hash) {
    this._requireLoad()
    this._requireAuth()
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

  async close () {
    this._requireLoad()
    await this._db.close()
  }

  async _load (dbString) {
    if (!this._accessController) await this._initAcConfigs()

    this._db = await this.replicator._orbitdb.feed(dbString || this._name, {
      ...ORBITDB_OPTS,
      accessController: this._accessController
    })

    await this._db.load()
    this._feedAddress = this._db.address.toString()
    this._replicator.ensureConnected(this._feedAddress, true)

    return this._feedAddress
  }

  async _loadReadOnly (dbString, ipfs) {
    if (!this._accessController) await this._initAcConfigs()

    const orbit = await OrbitDB.createInstance(ipfs)
    this._db = await orbit.feed(dbString || this._name, {
      ...ORBITDB_OPTS,
      accessController: this._accessController
    })

    await this._db.load()
    this._feedAddress = this._db.address.toString()
    return this._feedAddress
  }

  async _save () {
    this._requireLoad()
    return await this._db.access.save()
  }

  _requireLoad () {
    if (!this._db) throw new Error('_load must be called before interacting with the store')
  }

  _requireAuth () {
    if (!this._authenticated) throw new Error('You must authenticate before performing this action')
  }

  async _setIdentity (odbId) {
    this._db.setIdentity(odbId)
    this._authenticated = true
  }

  async _initAcConfigs () {
    if (this._accessController) return

    this._accessController = {
      type: 'eth-contract/rain-community',
      web3: this._web3,
      abi: this._abi,
      contractAddress: this._contractAddress
    }
  }
}

module.exports = Community
