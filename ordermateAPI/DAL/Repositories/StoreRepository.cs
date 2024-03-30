using Dapper;
using ordermateAPI.DAL.Interfaces;
using ordermateAPI.DAL.Models;
using ordermateAPI.DAL.Scripts;

namespace ordermateAPI.DAL.Repositories;

public class StoreRepository : IStoreRepository
{
    private readonly IDbContext _dbContext;

    public StoreRepository(IDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    public async Task<StoreModel?> Get(int storeId)
    {
        using var connection = _dbContext.CreateConnection();
        return await connection.QuerySingleOrDefaultAsync<StoreModel>(StoreScripts.Get, new { storeId });
    }
}