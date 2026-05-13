const asyncHandler = (fn) => {
    return(res,req,next) => {
        Promise.resolve(fn(req,res,next)).catch(next)
    }
}

export default asyncHandler;